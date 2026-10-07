import { describe, it, expect } from "vitest";
import { inflate, MAX_INFLATED_BYTES } from "./inflate";

const deflate = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const cs = new CompressionStream("deflate");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

describe("inflate — decompression-bomb guard (SEC-H1)", () => {
  it("round-trips a normal payload", async () => {
    const data = new TextEncoder().encode("hello monet ".repeat(100));
    const out = await inflate(await deflate(data));
    expect(out).toEqual(data);
  });

  it("rejects output that exceeds the hard cap instead of allocating it", async () => {
    const realDecompressionStream = globalThis.DecompressionStream;
    const chunk = new Uint8Array(64 * 1024);
    const iterations = Math.ceil((MAX_INFLATED_BYTES + 1) / chunk.length);

    class BombDecompressionStream {
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array>;

      constructor() {
        const stream = new TransformStream<Uint8Array, Uint8Array>({
          transform(_input, controller) {
            for (let i = 0; i < iterations; i++) controller.enqueue(chunk);
          },
        });
        this.readable = stream.readable;
        this.writable = stream.writable;
      }
    }

    try {
      globalThis.DecompressionStream = BombDecompressionStream as unknown as typeof DecompressionStream;
      await expect(inflate(new Uint8Array([0]))).rejects.toThrow(/cap|bomb/i);
    } finally {
      globalThis.DecompressionStream = realDecompressionStream;
    }
  });
});
