//! # monet-mcp · a local MCP server for every Monet app
//!
//! This crate is a [Tauri 2 plugin] that turns a *running* Monet app into a
//! local [Model Context Protocol] server, so an MCP client (Claude Desktop /
//! Claude Code, the MCP Inspector) can drive the live app — same engine, same
//! document, live UI.
//!
//! ## Design
//!
//! The plugin is a thin, transport-only layer. It runs a tiny localhost HTTP
//! server (`POST 127.0.0.1:<port>/mcp`, bearer-token auth) and forwards each
//! JSON-RPC message to the webview over a Tauri event, where the
//! `@monet-ui/monet-mcp` bridge owns the actual MCP protocol + the codegen'd
//! tool manifest. The reply comes back over another event. Because it uses
//! ordinary events (covered by the `core:default` capability), **no extra ACL
//! permission is required** in an app's capabilities.
//!
//! ```text
//! tauri::Builder::default()
//!     .invoke_handler(monet_ui::invoke_handler())
//!     .plugin(monet_ui::dialog_plugin())
//!     .plugin(monet_mcp::init(monet_mcp::McpOptions::new("Monet Vision").port(48211)))
//!     // ...
//! ```
//!
//! The bound URL + token are written to `mcp.json` in the app's config dir and
//! emitted on `monet://mcp/ready` so the frontend (and the user, for their MCP
//! client config) can find them.
//!
//! [Tauri 2 plugin]: https://v2.tauri.app/develop/plugins/
//! [Model Context Protocol]: https://modelcontextprotocol.io/

use std::collections::HashMap;
use std::io::Read;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Emitter, Listener, Manager, Runtime,
};
use tiny_http::{Header, Method, Response, Server};

/// Event names bridging the HTTP host (Rust) and the MCP server (webview).
pub const EV_REQUEST: &str = "monet://mcp/request";
pub const EV_RESPONSE: &str = "monet://mcp/response";
pub const EV_READY: &str = "monet://mcp/ready";
pub const EV_HELLO: &str = "monet://mcp/hello";

/// How long the HTTP host waits for the webview to answer a request before it
/// returns a JSON-RPC error (e.g. the window hasn't booted the bridge yet).
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(60);

/// Maximum encoded HTTP request body accepted by the localhost MCP host.
///
/// Vision's largest published tool argument is a 1 MiB Camera Raw recipe
/// string. A 2 MiB transport envelope leaves room for the JSON-RPC request and
/// JSON string escaping while keeping both declared and chunked bodies bounded
/// before anything is forwarded to the webview.
const MAX_MCP_HTTP_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RequestBodyError {
    TooLarge,
    Invalid,
}

/// Plugin configuration.
pub struct McpOptions {
    app: String,
    port: u16,
    port_range: u16,
}

impl McpOptions {
    /// Create options for an app. `app` is a human label used in logs and the
    /// connection file (e.g. `"Monet Vision"`).
    pub fn new(app: impl Into<String>) -> Self {
        Self {
            app: app.into(),
            port: 0,
            port_range: 16,
        }
    }

    /// Preferred TCP port on `127.0.0.1`. `0` (default) lets the OS pick. When
    /// non-zero, the host tries up to [`McpOptions::port_range`] consecutive
    /// ports before falling back to an OS-assigned one.
    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    /// How many consecutive ports to try starting at [`McpOptions::port`].
    pub fn port_range(mut self, range: u16) -> Self {
        self.port_range = range.max(1);
        self
    }
}

/// Connection details, also written to `mcp.json` and emitted on [`EV_READY`].
#[derive(Clone, Serialize)]
struct Connection {
    url: String,
    token: String,
}

/// Payload of [`EV_REQUEST`]: a correlation id + the raw JSON-RPC text.
#[derive(Clone, Serialize)]
struct RequestMsg {
    id: u64,
    payload: String,
}

/// Payload of [`EV_RESPONSE`]: the correlation id + the raw JSON-RPC reply
/// (empty string for a notification → HTTP 202).
#[derive(Deserialize)]
struct ResponseMsg {
    id: u64,
    payload: String,
}

/// Pending HTTP requests awaiting a webview reply, keyed by correlation id.
type Pending = Arc<Mutex<HashMap<u64, Sender<String>>>>;

/// Build the `monet-mcp` plugin.
pub fn init<R: Runtime>(opts: McpOptions) -> TauriPlugin<R> {
    Builder::new("monet-mcp")
        .setup(move |app, _api| {
            let token = generate_token();
            let (server, addr) = bind_server(opts.port, opts.port_range)?;
            let url = format!("http://{addr}/mcp");
            let conn = Connection {
                url: url.clone(),
                token: token.clone(),
            };

            let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

            // webview → host: route replies to the waiting HTTP request.
            {
                let pending = pending.clone();
                app.listen_any(EV_RESPONSE, move |event| {
                    if let Ok(msg) = serde_json::from_str::<ResponseMsg>(event.payload()) {
                        if let Some(tx) = pending.lock().unwrap().remove(&msg.id) {
                            let _ = tx.send(msg.payload);
                        }
                    }
                });
            }

            // webview → host: a fresh bridge says hello; re-announce the endpoint.
            {
                let app = app.clone();
                let conn = conn.clone();
                app.clone().listen_any(EV_HELLO, move |_event| {
                    let _ = app.emit(EV_READY, conn.clone());
                });
            }

            // Persist the connection for the user's MCP client config, and log it.
            write_connection_file(app, &opts.app, &conn);
            eprintln!("[monet-mcp] {} MCP server listening at {}", opts.app, url);
            // Announce now in case the frontend is already listening.
            let _ = app.emit(EV_READY, conn.clone());

            // Spawn the HTTP host on its own thread.
            let app_handle = app.clone();
            std::thread::Builder::new()
                .name("monet-mcp-http".into())
                .spawn(move || serve(server, app_handle, pending, token))
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            Ok(())
        })
        .build()
}

/// 48 hex chars from the OS CSPRNG.
fn generate_token() -> String {
    let mut buf = [0u8; 24];
    getrandom::getrandom(&mut buf).expect("OS CSPRNG unavailable");
    let mut s = String::with_capacity(48);
    for b in buf {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
    }
    s
}

/// Bind a localhost server, honouring a preferred port + small range, then
/// falling back to an OS-assigned ephemeral port.
fn bind_server(port: u16, range: u16) -> Result<(Server, SocketAddr), Box<dyn std::error::Error>> {
    let try_bind = |addr: &str| Server::http(addr).ok();

    if port != 0 {
        for p in port..port.saturating_add(range.max(1)) {
            if let Some(server) = try_bind(&format!("127.0.0.1:{p}")) {
                let addr = server
                    .server_addr()
                    .to_ip()
                    .ok_or("bound server has no IP address")?;
                return Ok((server, addr));
            }
        }
    }
    // Ephemeral fallback.
    let server = Server::http("127.0.0.1:0").map_err(|e| -> Box<dyn std::error::Error> {
        format!("failed to bind MCP HTTP server: {e}").into()
    })?;
    let addr = server
        .server_addr()
        .to_ip()
        .ok_or("bound server has no IP address")?;
    Ok((server, addr))
}

/// The blocking accept loop. One client at a time is plenty for MCP; each
/// request round-trips to the webview and back before the next is read.
fn serve<R: Runtime>(server: Server, app: AppHandle<R>, pending: Pending, token: String) {
    let counter = AtomicU64::new(1);
    for request in server.incoming_requests() {
        handle_request(request, &token, |body| {
            let id = counter.fetch_add(1, Ordering::SeqCst);
            let (tx, rx) = channel::<String>();
            pending.lock().unwrap().insert(id, tx);
            let _ = app.emit(EV_REQUEST, RequestMsg { id, payload: body });

            match rx.recv_timeout(BRIDGE_TIMEOUT) {
                Ok(payload) => Some(payload),
                Err(_) => {
                    pending.lock().unwrap().remove(&id);
                    None
                }
            }
        });
    }
}

/** Handle one real HTTP request while leaving the webview bridge injectable.
 * This keeps transport/auth tests on actual sockets without constructing Tauri. */
fn handle_request<F>(mut request: tiny_http::Request, token: &str, forward: F)
where
    F: FnOnce(String) -> Option<String>,
{
    let method = request.method().clone();
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("");

    // CORS preflight (helps browser-based inspectors; native clients ignore).
    if method == Method::Options {
        let _ = request.respond(cors(Response::empty(204)));
        return;
    }
    if path != "/mcp" {
        let _ = request.respond(cors(
            Response::from_string("not found").with_status_code(404),
        ));
        return;
    }
    if method == Method::Get {
        // Lightweight liveness probe (no secrets).
        let body = r#"{"server":"monet-mcp","transport":"http"}"#;
        let _ = request.respond(cors(json_response(body)));
        return;
    }
    if method != Method::Post {
        let _ = request.respond(cors(
            Response::from_string("method not allowed").with_status_code(405),
        ));
        return;
    }
    let declared_body_length = request.body_length();
    if declared_body_length.is_some_and(|length| length > MAX_MCP_HTTP_BODY_BYTES) {
        let _ = request.respond(cors(request_body_error_response(
            RequestBodyError::TooLarge,
        )));
        return;
    }
    if !authorized(&request, &url, token) {
        let _ = request.respond(cors(
            Response::from_string("unauthorized").with_status_code(401),
        ));
        return;
    }

    let body = match read_request_body(request.as_reader(), declared_body_length) {
        Ok(body) => body,
        Err(error) => {
            let _ = request.respond(cors(request_body_error_response(error)));
            return;
        }
    };

    // Read the id BEFORE the body is forwarded — the timeout reply needs it.
    let id = request_id(&body);

    match forward(body) {
        Some(payload) if payload.is_empty() => {
            let _ = request.respond(cors(Response::empty(202)));
        }
        Some(payload) => {
            let _ = request.respond(cors(json_response(&payload)));
        }
        None => {
            let err = format!(
                r#"{{"jsonrpc":"2.0","id":{id},"error":{{"code":-32001,"message":"MCP bridge timeout — is the app window open?"}}}}"#
            );
            let _ = request.respond(cors(json_response(&err)));
        }
    }
}

/// The request's JSON-RPC `id`, as the JSON text to echo back. JSON-RPC 2.0
/// requires a response id EQUAL to the request's; `null` is reserved for an id
/// that could not be determined, and a conforming client (Claude Desktop/Code,
/// the Inspector) discards a `null`-id frame and keeps waiting — turning a clean
/// "is the app window open?" diagnostic into an apparent hang (#231).
///
/// `null` only when there genuinely is no readable scalar id: a notification, an
/// unparseable body, or a batch (whose elements carry their own ids — the
/// webview bridge answers those; this is only the timeout path).
fn request_id(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("id").cloned())
        .filter(|id| id.is_string() || id.is_number())
        .map(|id| id.to_string())
        .unwrap_or_else(|| "null".to_string())
}

/// Read at most one byte beyond the transport ceiling so unknown-length and
/// chunked bodies can be rejected without buffering the complete request.
fn read_request_body<R: Read + ?Sized>(
    reader: &mut R,
    declared_length: Option<usize>,
) -> Result<String, RequestBodyError> {
    if declared_length.is_some_and(|length| length > MAX_MCP_HTTP_BODY_BYTES) {
        return Err(RequestBodyError::TooLarge);
    }

    let mut bytes = Vec::with_capacity(declared_length.unwrap_or(0));
    reader
        .take((MAX_MCP_HTTP_BODY_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| RequestBodyError::Invalid)?;
    if bytes.len() > MAX_MCP_HTTP_BODY_BYTES {
        return Err(RequestBodyError::TooLarge);
    }
    String::from_utf8(bytes).map_err(|_| RequestBodyError::Invalid)
}

fn request_body_error_response(error: RequestBodyError) -> Response<std::io::Cursor<Vec<u8>>> {
    match error {
        RequestBodyError::TooLarge => {
            Response::from_string("payload too large").with_status_code(413)
        }
        RequestBodyError::Invalid => Response::from_string("bad request").with_status_code(400),
    }
}

/// Accept the bearer token either in `Authorization: Bearer <token>` or a
/// `?token=` query parameter (convenient for the MCP Inspector).
fn authorized(request: &tiny_http::Request, url: &str, token: &str) -> bool {
    for header in request.headers() {
        if header.field.equiv("Authorization") {
            let value = header.value.as_str();
            if let Some(rest) = value.strip_prefix("Bearer ") {
                if rest.trim() == token {
                    return true;
                }
            }
        }
    }
    if let Some(query) = url.split('?').nth(1) {
        for pair in query.split('&') {
            if let Some(v) = pair.strip_prefix("token=") {
                if v == token {
                    return true;
                }
            }
        }
    }
    false
}

fn json_response(body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(body)
        .with_status_code(200)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
}

/// Add permissive CORS headers. Endpoint is localhost + token-gated.
fn cors<D: Read>(response: Response<D>) -> Response<D> {
    response
        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap())
        .with_header(
            Header::from_bytes(
                "Access-Control-Allow-Headers",
                "Authorization, Content-Type",
            )
            .unwrap(),
        )
        .with_header(
            Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
        )
}

/// Write `{ url, token }` to `<app config dir>/mcp.json` for the user's MCP
/// client configuration. Best-effort; failures are logged, not fatal.
fn write_connection_file<R: Runtime>(app: &AppHandle<R>, label: &str, conn: &Connection) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("mcp.json");
    let body = serde_json::json!({
        "app": label,
        "url": conn.url,
        "token": conn.token,
    });
    if let Ok(text) = serde_json::to_string_pretty(&body) {
        let _ = std::fs::write(&path, text);
        eprintln!("[monet-mcp] connection written to {}", path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Error, Write as _};
    use std::net::{Shutdown, TcpListener, TcpStream};

    fn exchange<F>(server: &Server, addr: SocketAddr, request: String, forward: F) -> String
    where
        F: FnOnce(String) -> Option<String>,
    {
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.write_all(request.as_bytes()).unwrap();
            stream.shutdown(Shutdown::Write).unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            response
        });
        handle_request(server.recv().unwrap(), "secret", forward);
        client.join().unwrap()
    }

    fn post(path: &str, authorization: Option<&str>, body: &str) -> String {
        format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Type: application/json\r\n{}Content-Length: {}\r\n\r\n{body}",
            authorization
                .map(|value| format!("Authorization: {value}\r\n"))
                .unwrap_or_default(),
            body.len(),
        )
    }

    struct PanicReader;

    impl Read for PanicReader {
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            panic!("oversized declared bodies must be rejected before reading");
        }
    }

    struct FailingReader;

    impl Read for FailingReader {
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            Err(Error::other("read failed"))
        }
    }

    #[test]
    fn accepts_a_declared_body_at_the_transport_limit() {
        let payload = vec![b'a'; MAX_MCP_HTTP_BODY_BYTES];
        let mut reader = Cursor::new(payload);

        let body = read_request_body(&mut reader, Some(MAX_MCP_HTTP_BODY_BYTES)).unwrap();

        assert_eq!(body.len(), MAX_MCP_HTTP_BODY_BYTES);
    }

    #[test]
    fn rejects_an_oversized_declared_body_without_reading_it() {
        let mut reader = PanicReader;

        let error = read_request_body(&mut reader, Some(MAX_MCP_HTTP_BODY_BYTES + 1));

        assert_eq!(error, Err(RequestBodyError::TooLarge));
        assert_eq!(
            request_body_error_response(RequestBodyError::TooLarge)
                .status_code()
                .0,
            413
        );
    }

    #[test]
    fn bounds_unknown_length_streams_to_limit_plus_one_byte() {
        let mut at_limit = Cursor::new(vec![b'a'; MAX_MCP_HTTP_BODY_BYTES]);
        assert_eq!(
            read_request_body(&mut at_limit, None).unwrap().len(),
            MAX_MCP_HTTP_BODY_BYTES
        );

        let mut over_limit = std::io::repeat(b'a');
        assert_eq!(
            read_request_body(&mut over_limit, None),
            Err(RequestBodyError::TooLarge)
        );
    }

    #[test]
    fn maps_stream_errors_and_invalid_utf8_to_bad_request() {
        let mut failing = FailingReader;
        assert_eq!(
            read_request_body(&mut failing, None),
            Err(RequestBodyError::Invalid)
        );

        let mut invalid_utf8 = Cursor::new([0xff]);
        assert_eq!(
            read_request_body(&mut invalid_utf8, Some(1)),
            Err(RequestBodyError::Invalid)
        );
        assert_eq!(
            request_body_error_response(RequestBodyError::Invalid)
                .status_code()
                .0,
            400
        );
    }

    #[test]
    fn binds_around_a_busy_preferred_port_and_generates_fresh_tokens() {
        let occupied = TcpListener::bind("127.0.0.1:0").unwrap();
        let preferred = occupied.local_addr().unwrap().port();
        let (_server, bound) = bind_server(preferred, 1).unwrap();
        assert_ne!(bound.port(), preferred);

        let first = generate_token();
        let second = generate_token();
        assert_eq!(first.len(), 48);
        assert!(first.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn serves_liveness_auth_requests_notifications_and_timeouts_over_http() {
        let (server, addr) = bind_server(0, 1).unwrap();
        let get = exchange(
            &server,
            addr,
            "GET /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n".into(),
            |_| panic!("GET must not reach the bridge"),
        );
        assert!(get.starts_with("HTTP/1.1 200"), "{get}");
        assert!(get.contains(r#"{"server":"monet-mcp","transport":"http"}"#));

        let unauthorized = exchange(
            &server,
            addr,
            post("/mcp", Some("Bearer wrong"), "{}"),
            |_| panic!("unauthorized requests must not reach the bridge"),
        );
        assert!(unauthorized.starts_with("HTTP/1.1 401"), "{unauthorized}");

        let rpc = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let mut forwarded = String::new();
        let ok = exchange(
            &server,
            addr,
            post("/mcp", Some("Bearer secret"), rpc),
            |body| {
                forwarded = body;
                Some(r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#.into())
            },
        );
        assert_eq!(forwarded, rpc);
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        assert!(ok.contains(r#""result":{"ok":true}"#));

        let notification = exchange(&server, addr, post("/mcp?token=secret", None, "{}"), |_| {
            Some(String::new())
        });
        assert!(notification.starts_with("HTTP/1.1 202"), "{notification}");

        let timeout = exchange(
            &server,
            addr,
            post("/mcp", Some("Bearer secret"), "{}"),
            |_| None,
        );
        assert!(timeout.starts_with("HTTP/1.1 200"), "{timeout}");
        assert!(timeout.contains("MCP bridge timeout"));
        assert!(timeout.contains(r#""id":null"#), "no id to echo: {timeout}");

        // The timeout error must carry the id of the request it answers (#231) —
        // a `null` id is unroutable and leaves the client's call pending.
        let identified = exchange(
            &server,
            addr,
            post(
                "/mcp",
                Some("Bearer secret"),
                r#"{"jsonrpc":"2.0","id":7,"method":"tools/list"}"#,
            ),
            |_| None,
        );
        assert!(identified.contains(r#""id":7"#), "{identified}");
        let string_id = exchange(
            &server,
            addr,
            post(
                "/mcp",
                Some("Bearer secret"),
                r#"{"jsonrpc":"2.0","id":"abc","method":"tools/list"}"#,
            ),
            |_| None,
        );
        assert!(string_id.contains(r#""id":"abc""#), "{string_id}");
    }

    #[test]
    fn request_id_echoes_scalars_and_falls_back_to_null() {
        assert_eq!(request_id(r#"{"jsonrpc":"2.0","id":7}"#), "7");
        assert_eq!(request_id(r#"{"id":"abc"}"#), "\"abc\"");
        assert_eq!(request_id(r#"{"method":"notify"}"#), "null"); // notification
        assert_eq!(request_id(r#"{"id":{"nested":1}}"#), "null"); // not a scalar id
        assert_eq!(request_id("not json"), "null");
        assert_eq!(request_id(r#"[{"id":1},{"id":2}]"#), "null"); // batch
    }
}
