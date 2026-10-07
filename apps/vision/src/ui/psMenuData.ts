// AUTO-GENERATED from the photoshop-menu-blueprint workflow (do not hand-edit).
// A faithful Adobe Photoshop (CC 2022/2023) menu structure. Items carry a
// `monetId` when Monet Vision implements the command; the rest are disabled
// placeholders so the menu bar matches Photoshop item-for-item. See
// src/ui/psMenus.ts (buildPhotoshopMenus) for how this is turned into the live
// menu bar, and native/macMenu.ts for the macOS install.

export type PsNode =
  | { kind: "separator" }
  | { kind: "item"; label: string; shortcut?: string; monetId?: string }
  | { kind: "submenu"; label: string; items: PsNode[] };

export interface PsMenu { id: string; label: string; tree: PsNode[]; }

export const PS_MENUS: PsMenu[] = [
  {
    "id": "file",
    "label": "File",
    "tree": [
      {
        "kind": "item",
        "label": "New…",
        "shortcut": "⌘N",
        "monetId": "new"
      },
      {
        "kind": "item",
        "label": "Open…",
        "shortcut": "⌘O",
        "monetId": "openf"
      },
      {
        "kind": "item",
        "label": "Browse in Bridge…",
        "shortcut": "⌥⌘O"
      },
      {
        "kind": "item",
        "label": "Open as Smart Object…",
        "monetId": "opensmartobject"
      },
      {
        "kind": "submenu",
        "label": "Open Recent",
        "items": [
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Clear Recent File List",
            "monetId": "clearrecent"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Document Browser…",
        "monetId": "browse"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Close",
        "shortcut": "⌘W",
        "monetId": "close"
      },
      {
        "kind": "item",
        "label": "Close All",
        "shortcut": "⌥⌘W",
        "monetId": "closeall"
      },
      {
        "kind": "item",
        "label": "Close Others",
        "monetId": "closeothers"
      },
      {
        "kind": "item",
        "label": "Close and Go to Bridge…",
        "shortcut": "⇧⌘W"
      },
      {
        "kind": "item",
        "label": "Save",
        "shortcut": "⌘S",
        "monetId": "save"
      },
      {
        "kind": "item",
        "label": "Save As…",
        "shortcut": "⇧⌘S",
        "monetId": "saveas"
      },
      {
        "kind": "item",
        "label": "Save a Copy…",
        "shortcut": "⌥⌘S",
        "monetId": "savecopy"
      },
      {
        "kind": "item",
        "label": "Revert",
        "shortcut": "F12",
        "monetId": "revert"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Invite to Edit…"
      },
      {
        "kind": "item",
        "label": "Share…"
      },
      {
        "kind": "item",
        "label": "Share for Review (Beta)…"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Export",
        "items": [
          {
            "kind": "item",
            "label": "Quick Export as PNG",
            "shortcut": "⌥⌘E",
            "monetId": "png"
          },
          {
            "kind": "item",
            "label": "Export As…",
            "monetId": "exportas",
            "shortcut": "⌥⇧⌘W"
          },
          {
            "kind": "item",
            "label": "Export at Sizes (1×/2×/3×)",
            "monetId": "exportsizes"
          },
          {
            "kind": "item",
            "label": "Content Credentials (JSON)…",
            "monetId": "contentcredentials"
          },
          {
            "kind": "item",
            "label": "Content Credentials (Signed)…",
            "monetId": "contentcredentialssigned"
          },
          {
            "kind": "item",
            "label": "Export Preferences…",
            "monetId": "exportprefs"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Export JPEG…",
            "monetId": "jpg"
          },
          {
            "kind": "item",
            "label": "Export PSD…",
            "monetId": "psd"
          },
          {
            "kind": "item",
            "label": "Export PSB…",
            "monetId": "psb"
          },
          {
            "kind": "item",
            "label": "Export CMYK PSD…",
            "monetId": "psdcmyk"
          },
          {
            "kind": "item",
            "label": "Export Animated GIF…",
            "monetId": "gif"
          },
          {
            "kind": "item",
            "label": "Export TIFF…",
            "monetId": "tiff"
          },
          {
            "kind": "item",
            "label": "Export WebP…",
            "monetId": "webp"
          },
          {
            "kind": "item",
            "label": "Export Radiance HDR…",
            "monetId": "exporthdr"
          },
          {
            "kind": "item",
            "label": "Export OpenEXR…",
            "monetId": "exr"
          },
          {
            "kind": "item",
            "label": "Export AVIF…",
            "monetId": "avif"
          },
          {
            "kind": "item",
            "label": "Export PDF…",
            "monetId": "exportpdf"
          },
          {
            "kind": "item",
            "label": "Export Video (codec)…",
            "monetId": "vid"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Save for Web…",
            "shortcut": "⌥⇧⌘S",
            "monetId": "saveforweb"
          },
          {
            "kind": "item",
            "label": "Artboards to Files…",
            "monetId": "artboardstofiles"
          },
          {
            "kind": "item",
            "label": "Artboards to PDF…",
            "monetId": "artboardstopdf"
          },
          {
            "kind": "item",
            "label": "Export Layers to Files…",
            "monetId": "exportlayers"
          },
          {
            "kind": "item",
            "label": "Layer Comps to Files…"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Color Lookup Tables…",
            "monetId": "exportcolorlut"
          },
          {
            "kind": "item",
            "label": "Data Sets as Files…",
            "monetId": "exportdatasets"
          },
          {
            "kind": "item",
            "label": "Paths to Illustrator…",
            "monetId": "pathstoai"
          },
          {
            "kind": "item",
            "label": "Render Video…",
            "monetId": "rendervideo"
          },
          {
            "kind": "item",
            "label": "Zoomify…",
            "monetId": "zoomify"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Generate",
        "items": [
          {
            "kind": "item",
            "label": "Image Assets",
            "monetId": "imageassets"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Place Embedded…",
        "monetId": "place"
      },
      {
        "kind": "item",
        "label": "Place Linked…",
        "monetId": "place"
      },
      {
        "kind": "item",
        "label": "Package…"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Automate",
        "items": [
          {
            "kind": "item",
            "label": "Batch…",
            "monetId": "batch"
          },
          {
            "kind": "item",
            "label": "Create Droplet…"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Crop and Straighten Photos",
            "monetId": "cropstraighten"
          },
          {
            "kind": "item",
            "label": "Contact Sheet II…",
            "monetId": "contactsheet"
          },
          {
            "kind": "item",
            "label": "Conditional Mode Change…",
            "monetId": "conditionalmode"
          },
          {
            "kind": "item",
            "label": "Fit Image…",
            "monetId": "fitimage"
          },
          {
            "kind": "item",
            "label": "Lens Correction…",
            "monetId": "lenscorrection"
          },
          {
            "kind": "item",
            "label": "Merge to HDR Pro…",
            "monetId": "hdr"
          },
          {
            "kind": "item",
            "label": "Photomerge…"
          },
          {
            "kind": "item",
            "label": "Picture Package…",
            "monetId": "picturepackage"
          },
          {
            "kind": "item",
            "label": "PDF Presentation…",
            "monetId": "pdfpresentation"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Scripts",
        "items": [
          {
            "kind": "item",
            "label": "Scripting Console…",
            "monetId": "script"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Image Processor…",
            "monetId": "imageprocessor"
          },
          {
            "kind": "item",
            "label": "Delete All Empty Layers",
            "monetId": "delemptylayers"
          },
          {
            "kind": "item",
            "label": "Layer Cleanup…",
            "monetId": "layercleanup"
          },
          {
            "kind": "item",
            "label": "Flatten All Layer Effects",
            "monetId": "flatteneffects"
          },
          {
            "kind": "item",
            "label": "Flatten All Masks",
            "monetId": "flattenmasks"
          },
          {
            "kind": "item",
            "label": "Script Events Manager…"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Load Files into Stack…",
            "monetId": "loadfilesstack"
          },
          {
            "kind": "item",
            "label": "Load Multiple DICOM Files…"
          },
          {
            "kind": "item",
            "label": "Statistics…",
            "monetId": "statistics"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Browse…",
            "monetId": "scriptbrowse"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Import",
        "items": [
          {
            "kind": "item",
            "label": "Open GIF as Animation…",
            "monetId": "opengif"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Variable Data Sets…",
            "monetId": "importdatasets"
          },
          {
            "kind": "item",
            "label": "Video Frames to Layers…",
            "monetId": "videoframes"
          },
          {
            "kind": "item",
            "label": "Notes…"
          },
          {
            "kind": "item",
            "label": "WIA Support…"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "File Info…",
        "monetId": "fileinfo",
        "shortcut": "⌥⇧⌘I"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Print…",
        "shortcut": "⌘P",
        "monetId": "print"
      },
      {
        "kind": "item",
        "label": "Print One Copy",
        "shortcut": "⌥⇧⌘P",
        "monetId": "printone"
      }
    ]
  },
  {
    "id": "edit",
    "label": "Edit",
    "tree": [
      {
        "kind": "item",
        "label": "Undo",
        "shortcut": "⌘Z",
        "monetId": "undo"
      },
      {
        "kind": "item",
        "label": "Redo",
        "shortcut": "⇧⌘Z",
        "monetId": "redo"
      },
      {
        "kind": "item",
        "label": "Toggle Last State",
        "shortcut": "⌥⌘Z",
        "monetId": "togglelaststate"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Fade…",
        "shortcut": "⇧⌘F",
        "monetId": "fade"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Cut",
        "shortcut": "⌘X",
        "monetId": "cut"
      },
      {
        "kind": "item",
        "label": "Copy",
        "shortcut": "⌘C",
        "monetId": "copy"
      },
      {
        "kind": "item",
        "label": "Copy Merged",
        "shortcut": "⇧⌘C",
        "monetId": "copymerged"
      },
      {
        "kind": "item",
        "label": "Paste",
        "shortcut": "⌘V",
        "monetId": "paste"
      },
      {
        "kind": "submenu",
        "label": "Paste Special",
        "items": [
          {
            "kind": "item",
            "label": "Paste in Place",
            "shortcut": "⇧⌘V",
            "monetId": "pasteinplace"
          },
          {
            "kind": "item",
            "label": "Paste Into",
            "shortcut": "⌥⇧⌘V",
            "monetId": "pasteinto"
          },
          {
            "kind": "item",
            "label": "Paste Outside",
            "monetId": "pasteoutside"
          }
        ]
      },
      {
        "kind": "item",
        "label": "Clear",
        "shortcut": "⌫",
        "monetId": "clear"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Search",
        "shortcut": "⌘F",
        "monetId": "search"
      },
      {
        "kind": "item",
        "label": "Check Spelling…"
      },
      {
        "kind": "item",
        "label": "Find and Replace Text…",
        "monetId": "findreplace"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Fill…",
        "shortcut": "⇧F5",
        "monetId": "fill"
      },
      {
        "kind": "item",
        "label": "Fill with Foreground Color",
        "shortcut": "⌥⌫",
        "monetId": "fillfg"
      },
      {
        "kind": "item",
        "label": "Fill with Background Color",
        "shortcut": "⌘⌫",
        "monetId": "fillbg"
      },
      {
        "kind": "item",
        "label": "Stroke…",
        "monetId": "stroke"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Content-Aware Fill…",
        "monetId": "caf"
      },
      {
        "kind": "item",
        "label": "Remove Distractions…",
        "monetId": "removedistractions"
      },
      {
        "kind": "item",
        "label": "Remove Reflections…",
        "monetId": "removereflections"
      },
      {
        "kind": "item",
        "label": "Generative Fill (Synthesis)",
        "monetId": "genfill"
      },
      {
        "kind": "item",
        "label": "Generative Fill (AI · MI-GAN)",
        "monetId": "genfillml"
      },
      {
        "kind": "item",
        "label": "Generate Image (AI · Diffusion)…",
        "monetId": "genimage"
      },
      {
        "kind": "item",
        "label": "Generative Expand (AI · MI-GAN)…",
        "monetId": "genexpand"
      },
      {
        "kind": "item",
        "label": "Generate Background (AI · Diffusion)…",
        "monetId": "genbg"
      },
      {
        "kind": "item",
        "label": "Patch Selection",
        "monetId": "patch"
      },
      {
        "kind": "item",
        "label": "Content-Aware Scale",
        "shortcut": "⌥⇧⌘C",
        "monetId": "contentawarescale"
      },
      {
        "kind": "item",
        "label": "Puppet Warp",
        "monetId": "puppet"
      },
      {
        "kind": "item",
        "label": "Perspective Warp",
        "monetId": "persp"
      },
      {
        "kind": "item",
        "label": "Free Transform…",
        "shortcut": "⌘T",
        "monetId": "freexf"
      },
      {
        "kind": "submenu",
        "label": "Transform",
        "items": [
          {
            "kind": "item",
            "label": "Again",
            "shortcut": "⇧⌘T",
            "monetId": "transformagain"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Scale",
            "monetId": "xfscale"
          },
          {
            "kind": "item",
            "label": "Rotate",
            "monetId": "xfrotate"
          },
          {
            "kind": "item",
            "label": "Skew…",
            "monetId": "skew"
          },
          {
            "kind": "item",
            "label": "Distort",
            "monetId": "xfdistort"
          },
          {
            "kind": "item",
            "label": "Perspective",
            "monetId": "persp"
          },
          {
            "kind": "item",
            "label": "Warp",
            "monetId": "xfwarp"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Rotate 180°",
            "monetId": "rl180"
          },
          {
            "kind": "item",
            "label": "Rotate 90° Clockwise",
            "monetId": "rl90cw"
          },
          {
            "kind": "item",
            "label": "Rotate 90° Counter Clockwise",
            "monetId": "rl90ccw"
          },
          {
            "kind": "item",
            "label": "Flip Horizontal",
            "monetId": "flh"
          },
          {
            "kind": "item",
            "label": "Flip Vertical",
            "monetId": "flv"
          }
        ]
      },
      {
        "kind": "item",
        "label": "Auto-Align Layers…",
        "monetId": "autoalignlayers"
      },
      {
        "kind": "item",
        "label": "Auto-Blend Layers…",
        "monetId": "autoblendlayers"
      },
      {
        "kind": "item",
        "label": "Sky Replacement…",
        "monetId": "skyreplacement"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Define Brush Preset…",
        "monetId": "definebrush"
      },
      {
        "kind": "item",
        "label": "Define Pattern",
        "monetId": "defpat"
      },
      {
        "kind": "item",
        "label": "Define Custom Shape…",
        "monetId": "definecustomshape"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Purge",
        "monetId": "purge"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Adobe PDF Presets…"
      },
      {
        "kind": "item",
        "label": "Presets"
      },
      {
        "kind": "item",
        "label": "Remote Connections…"
      },
      {
        "kind": "item",
        "label": "Color Settings…",
        "shortcut": "⇧⌘K",
        "monetId": "colorsettings"
      },
      {
        "kind": "item",
        "label": "Assign Profile…",
        "monetId": "assignprofile"
      },
      {
        "kind": "item",
        "label": "Convert to Profile…",
        "monetId": "converttoprofile"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Keyboard Shortcuts…",
        "shortcut": "⌥⇧⌘K",
        "monetId": "prefgeneral"
      },
      {
        "kind": "item",
        "label": "Menus…",
        "shortcut": "⌥⇧⌘M",
        "monetId": "prefgeneral"
      },
      {
        "kind": "item",
        "label": "Toolbar…",
        "monetId": "prefgeneral"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Preferences",
        "items": [
          { "kind": "item", "label": "General…", "shortcut": "⌘K", "monetId": "prefgeneral" },
          { "kind": "item", "label": "Interface…", "monetId": "prefinterface" },
          { "kind": "item", "label": "Workspace…", "monetId": "prefworkspace" },
          { "kind": "item", "label": "Tools…", "monetId": "preftools" },
          { "kind": "item", "label": "History Log…", "monetId": "prefhistory" },
          { "kind": "item", "label": "File Handling…", "monetId": "preffile" },
          { "kind": "item", "label": "Export…", "monetId": "prefexport" },
          { "kind": "item", "label": "Performance…", "monetId": "prefperf" },
          { "kind": "item", "label": "Scratch Disks…", "monetId": "prefscratch" },
          { "kind": "item", "label": "Cursors…", "monetId": "prefcursors" },
          { "kind": "item", "label": "Transparency & Gamut…", "monetId": "preftransp" },
          { "kind": "item", "label": "Units & Rulers…", "monetId": "prefunits" },
          { "kind": "item", "label": "Guides, Grid & Slices…", "monetId": "prefguides" },
          { "kind": "item", "label": "Plug-Ins…", "monetId": "prefplugins" },
          { "kind": "item", "label": "Type…", "monetId": "preftype" },
          { "kind": "item", "label": "Technology Previews…", "monetId": "preftech" },
          { "kind": "item", "label": "Product Improvement…", "monetId": "prefproduct" },
          { "kind": "item", "label": "Camera Raw…", "monetId": "prefcameraraw" }
        ]
      }
    ]
  },
  {
    "id": "image",
    "label": "Image",
    "tree": [
      {
        "kind": "submenu",
        "label": "Mode",
        "items": [
          {
            "kind": "item",
            "label": "Bitmap…",
            "monetId": "bitmapmode"
          },
          {
            "kind": "item",
            "label": "Grayscale",
            "monetId": "mgray"
          },
          {
            "kind": "item",
            "label": "Duotone…",
            "monetId": "duotone"
          },
          {
            "kind": "item",
            "label": "Indexed Color…",
            "monetId": "indexedcolor"
          },
          {
            "kind": "item",
            "label": "RGB Color",
            "monetId": "mrgb"
          },
          {
            "kind": "item",
            "label": "CMYK Color",
            "monetId": "mcmyk"
          },
          {
            "kind": "item",
            "label": "Lab Color",
            "monetId": "mlab"
          },
          {
            "kind": "item",
            "label": "Multichannel",
            "monetId": "mmultichannel"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "8 Bits/Channel",
            "monetId": "d8"
          },
          {
            "kind": "item",
            "label": "16 Bits/Channel",
            "monetId": "d16"
          },
          {
            "kind": "item",
            "label": "32 Bits/Channel",
            "monetId": "d32"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Color Table…",
            "monetId": "colortable"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Adjustments",
        "items": [
          {
            "kind": "item",
            "label": "Brightness/Contrast…",
            "monetId": "bc"
          },
          {
            "kind": "item",
            "label": "Levels…",
            "shortcut": "⌘L",
            "monetId": "lv"
          },
          {
            "kind": "item",
            "label": "Curves…",
            "shortcut": "⌘M",
            "monetId": "cv"
          },
          {
            "kind": "item",
            "label": "Exposure…",
            "monetId": "ex"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Vibrance…",
            "monetId": "vb"
          },
          {
            "kind": "item",
            "label": "Hue/Saturation…",
            "shortcut": "⌘U",
            "monetId": "hs"
          },
          {
            "kind": "item",
            "label": "Color Balance…",
            "shortcut": "⌘B",
            "monetId": "cb"
          },
          {
            "kind": "item",
            "label": "Black & White…",
            "shortcut": "⌥⇧⌘B",
            "monetId": "bw"
          },
          {
            "kind": "item",
            "label": "Photo Filter…",
            "monetId": "pf"
          },
          {
            "kind": "item",
            "label": "Channel Mixer…",
            "monetId": "cm"
          },
          {
            "kind": "item",
            "label": "Color Lookup…",
            "monetId": "colorlookup"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Invert",
            "shortcut": "⌘I",
            "monetId": "adjinv"
          },
          {
            "kind": "item",
            "label": "Posterize…",
            "monetId": "po"
          },
          {
            "kind": "item",
            "label": "Threshold…",
            "monetId": "th"
          },
          {
            "kind": "item",
            "label": "Gradient Map…",
            "monetId": "gm"
          },
          {
            "kind": "item",
            "label": "Selective Color…",
            "monetId": "sc"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Shadows/Highlights…",
            "monetId": "shl"
          },
          {
            "kind": "item",
            "label": "HDR Toning…",
            "monetId": "hdrtoning"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Desaturate",
            "shortcut": "⇧⌘U",
            "monetId": "des"
          },
          {
            "kind": "item",
            "label": "Match Color…",
            "monetId": "matchcolor"
          },
          {
            "kind": "item",
            "label": "Replace Color…",
            "monetId": "rc"
          },
          {
            "kind": "item",
            "label": "Equalize",
            "monetId": "eq"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Auto Tone",
        "shortcut": "⇧⌘L",
        "monetId": "autotone"
      },
      {
        "kind": "item",
        "label": "Auto Contrast",
        "shortcut": "⌥⇧⌘L",
        "monetId": "autocontrast"
      },
      {
        "kind": "item",
        "label": "Auto Color",
        "shortcut": "⇧⌘B",
        "monetId": "autocolor"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Image Size…",
        "shortcut": "⌥⌘I",
        "monetId": "size"
      },
      {
        "kind": "item",
        "label": "Canvas Size…",
        "shortcut": "⌥⌘C",
        "monetId": "canvas"
      },
      {
        "kind": "submenu",
        "label": "Image Rotation",
        "items": [
          {
            "kind": "item",
            "label": "180°",
            "monetId": "rot180"
          },
          {
            "kind": "item",
            "label": "90° Clockwise",
            "monetId": "rcw"
          },
          {
            "kind": "item",
            "label": "90° Counter Clockwise",
            "monetId": "rccw"
          },
          {
            "kind": "item",
            "label": "Arbitrary…",
            "monetId": "rotarb"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Flip Canvas Horizontal",
            "monetId": "fh"
          },
          {
            "kind": "item",
            "label": "Flip Canvas Vertical",
            "monetId": "fv"
          }
        ]
      },
      {
        "kind": "item",
        "label": "Crop",
        "monetId": "cropsel"
      },
      {
        "kind": "item",
        "label": "Trim…",
        "monetId": "trim"
      },
      {
        "kind": "item",
        "label": "Reveal All",
        "monetId": "revealall"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Duplicate…",
        "monetId": "dupimg"
      },
      {
        "kind": "item",
        "label": "Apply Image…",
        "monetId": "applyimg"
      },
      {
        "kind": "item",
        "label": "Calculations…",
        "monetId": "calc"
      },
      {
        "kind": "item",
        "label": "Merge to HDR (Exposure Fusion)",
        "monetId": "hdr"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Variables",
        "items": [
          {
            "kind": "item",
            "label": "Define…",
            "monetId": "variablesdefine"
          },
          {
            "kind": "item",
            "label": "Data Sets…",
            "monetId": "datasets"
          }
        ]
      },
      {
        "kind": "item",
        "label": "Apply Data Set…",
        "monetId": "applydataset"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Trap…",
        "monetId": "trap"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Analysis",
        "items": [
          {
            "kind": "item",
            "label": "Set Measurement Scale",
            "monetId": "setmeasurescale"
          },
          {
            "kind": "item",
            "label": "Select Data Points…",
            "monetId": "selectdatapoints"
          },
          {
            "kind": "item",
            "label": "Record Measurements",
            "shortcut": "⇧⌘M",
            "monetId": "recordmeasurements"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Ruler Tool",
            "monetId": "rulertool"
          },
          {
            "kind": "item",
            "label": "Count Tool",
            "monetId": "counttool"
          },
          {
            "kind": "item",
            "label": "Color Sampler Tool",
            "monetId": "colorsamplertool"
          },
          {
            "kind": "item",
            "label": "Note Tool",
            "monetId": "notetool"
          },
          {
            "kind": "item",
            "label": "Place Scale Marker…",
            "monetId": "placescalemarker"
          }
        ]
      }
    ]
  },
  {
    "id": "layer",
    "label": "Layer",
    "tree": [
      {
        "kind": "submenu",
        "label": "New",
        "items": [
          {
            "kind": "item",
            "label": "Layer…",
            "shortcut": "⇧⌘N",
            "monetId": "nl"
          },
          {
            "kind": "item",
            "label": "Layer from Background…",
            "monetId": "layerfrombg"
          },
          {
            "kind": "item",
            "label": "Group…",
            "shortcut": "⌘G",
            "monetId": "newgroup"
          },
          {
            "kind": "item",
            "label": "Group from Layers…",
            "monetId": "groupfromlayers"
          },
          {
            "kind": "item",
            "label": "Artboard…",
            "monetId": "newartboard"
          },
          {
            "kind": "item",
            "label": "Artboard from Group…",
            "monetId": "artboardfromgroup"
          },
          {
            "kind": "item",
            "label": "Artboard from Layers…",
            "monetId": "artboardfromlayers"
          },
          {
            "kind": "item",
            "label": "Frame…",
            "monetId": "newframe"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Layer Via Copy",
            "shortcut": "⌘J",
            "monetId": "vcopy"
          },
          {
            "kind": "item",
            "label": "Layer Via Cut",
            "shortcut": "⇧⌘J",
            "monetId": "vcut"
          }
        ]
      },
      {
        "kind": "item",
        "label": "Copy CSS",
        "monetId": "copycss"
      },
      {
        "kind": "item",
        "label": "Copy SVG",
        "monetId": "copysvg"
      },
      {
        "kind": "item",
        "label": "Duplicate Layer…",
        "monetId": "dup"
      },
      {
        "kind": "item",
        "label": "Delete",
        "monetId": "del"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Quick Export as PNG",
        "monetId": "qexportpng",
        "shortcut": "⇧⌘'"
      },
      {
        "kind": "item",
        "label": "Export As…",
        "monetId": "exportas",
        "shortcut": "⌥⇧⌘'"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Rename Layer…",
        "monetId": "renamelayer"
      },
      {
        "kind": "item",
        "label": "Auto-Name Layers",
        "monetId": "autonamelayers"
      },
      {
        "kind": "item",
        "label": "Layer Cleanup…",
        "monetId": "layercleanup"
      },
      {
        "kind": "submenu",
        "label": "Layer Style",
        "items": [
          {
            "kind": "item",
            "label": "Blending Options…",
            "monetId": "blendopts"
          },
          {
            "kind": "item",
            "label": "Bevel & Emboss…",
            "monetId": "fxbevel"
          },
          {
            "kind": "item",
            "label": "Stroke…",
            "monetId": "fxstroke"
          },
          {
            "kind": "item",
            "label": "Inner Shadow…",
            "monetId": "fxinnershadow"
          },
          {
            "kind": "item",
            "label": "Inner Glow…",
            "monetId": "fxinnerglow"
          },
          {
            "kind": "item",
            "label": "Satin…",
            "monetId": "fxsatin"
          },
          {
            "kind": "item",
            "label": "Color Overlay…",
            "monetId": "fxcoloroverlay"
          },
          {
            "kind": "item",
            "label": "Gradient Overlay…",
            "monetId": "fxgradientoverlay"
          },
          {
            "kind": "item",
            "label": "Pattern Overlay…",
            "monetId": "fxpatternoverlay"
          },
          {
            "kind": "item",
            "label": "Outer Glow…",
            "monetId": "fxouterglow"
          },
          {
            "kind": "item",
            "label": "Drop Shadow…",
            "monetId": "fxdropshadow"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Copy Layer Style",
            "monetId": "fxcopy"
          },
          {
            "kind": "item",
            "label": "Paste Layer Style",
            "monetId": "fxpaste"
          },
          {
            "kind": "item",
            "label": "Clear Layer Style",
            "monetId": "fxclear"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Global Light…",
            "monetId": "globallight"
          },
          {
            "kind": "item",
            "label": "Create Layer",
            "monetId": "createlayersfromstyle"
          },
          {
            "kind": "item",
            "label": "Hide All Effects",
            "monetId": "hidealleffects"
          },
          {
            "kind": "item",
            "label": "Scale Effects…",
            "monetId": "scaleeffects"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Smart Filter",
        "items": [
          {
            "kind": "item",
            "label": "Enable Smart Filters",
            "monetId": "enablesmart"
          },
          {
            "kind": "item",
            "label": "Disable Smart Filters",
            "monetId": "disablesmart"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Delete Filter Mask",
            "monetId": "deletefiltermask"
          },
          {
            "kind": "item",
            "label": "Disable Filter Mask",
            "monetId": "disablefiltermask"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Clear Smart Filters",
            "monetId": "smartclr"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "New Fill Layer",
        "items": [
          {
            "kind": "item",
            "label": "Solid Color…",
            "monetId": "fillsolid"
          },
          {
            "kind": "item",
            "label": "Gradient…",
            "monetId": "fillgradient"
          },
          {
            "kind": "item",
            "label": "Pattern…",
            "monetId": "fillpattern"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "New Adjustment Layer",
        "items": [
          {
            "kind": "item",
            "label": "Brightness/Contrast…",
            "monetId": "alb"
          },
          {
            "kind": "item",
            "label": "Levels…",
            "monetId": "alLevels"
          },
          {
            "kind": "item",
            "label": "Curves…",
            "monetId": "alc"
          },
          {
            "kind": "item",
            "label": "Exposure…",
            "monetId": "ale"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Vibrance…",
            "monetId": "alv"
          },
          {
            "kind": "item",
            "label": "Hue/Saturation…",
            "monetId": "alh"
          },
          {
            "kind": "item",
            "label": "Color Balance…",
            "monetId": "alcb"
          },
          {
            "kind": "item",
            "label": "Black & White…",
            "monetId": "albw"
          },
          {
            "kind": "item",
            "label": "Photo Filter…",
            "monetId": "alpf"
          },
          {
            "kind": "item",
            "label": "Channel Mixer…",
            "monetId": "alcm"
          },
          {
            "kind": "item",
            "label": "Color Lookup…",
            "monetId": "alcolorlookup"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Invert",
            "monetId": "ali"
          },
          {
            "kind": "item",
            "label": "Posterize…",
            "monetId": "alp"
          },
          {
            "kind": "item",
            "label": "Threshold…",
            "monetId": "alt"
          },
          {
            "kind": "item",
            "label": "Gradient Map…",
            "monetId": "algm"
          },
          {
            "kind": "item",
            "label": "Selective Color…",
            "monetId": "alsc"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Desaturate",
            "monetId": "ald"
          }
        ]
      },
      {
        "kind": "item",
        "label": "Layer Content Options…"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Layer Mask",
        "items": [
          {
            "kind": "item",
            "label": "Reveal All",
            "monetId": "addmask"
          },
          {
            "kind": "item",
            "label": "Hide Layer Mask",
            "monetId": "hidemask"
          },
          {
            "kind": "item",
            "label": "Reveal Selection",
            "monetId": "revealsel"
          },
          {
            "kind": "item",
            "label": "Hide Selection",
            "monetId": "hidesel"
          },
          {
            "kind": "item",
            "label": "Layer Mask From Transparency",
            "monetId": "maskfromtransp"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Delete",
            "monetId": "delmask"
          },
          {
            "kind": "item",
            "label": "Apply",
            "monetId": "applymask"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Enable",
            "monetId": "enablemask"
          },
          {
            "kind": "item",
            "label": "Disable",
            "monetId": "disablemask"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Unlink",
            "monetId": "unlinkmask"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Vector Mask",
        "items": [
          {
            "kind": "item",
            "label": "Reveal All",
            "monetId": "vectormaskrevealall"
          },
          {
            "kind": "item",
            "label": "Hide All",
            "monetId": "vectormaskhideall"
          },
          {
            "kind": "item",
            "label": "Current Path",
            "monetId": "vectormaskpath"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Delete",
            "monetId": "vectormaskdelete"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Enable",
            "monetId": "vectormaskenable"
          },
          {
            "kind": "item",
            "label": "Link",
            "monetId": "vectormasklink"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Create Clipping Mask",
        "items": [
          {
            "kind": "item",
            "label": "Create Clipping Mask",
            "shortcut": "⌥⌘G",
            "monetId": "clipmask"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Smart Objects",
        "items": [
          {
            "kind": "item",
            "label": "Convert to Smart Object",
            "monetId": "smartobj"
          },
          {
            "kind": "item",
            "label": "New Smart Object via Copy",
            "monetId": "smartviacopy"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Edit Contents",
            "monetId": "soedit"
          },
          {
            "kind": "item",
            "label": "Update Edited Contents",
            "monetId": "soupdate"
          },
          {
            "kind": "item",
            "label": "Reset Transform",
            "monetId": "smartreset"
          },
          {
            "kind": "item",
            "label": "Update Modified Content…",
            "monetId": "soupdatelink"
          },
          {
            "kind": "item",
            "label": "Relink to File…",
            "monetId": "sorelink"
          },
          {
            "kind": "item",
            "label": "Relink to Library Graphic…"
          },
          {
            "kind": "item",
            "label": "Replace Contents…",
            "monetId": "soreplace"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Export Contents…",
            "monetId": "soexport"
          },
          {
            "kind": "item",
            "label": "Embed Linked",
            "monetId": "soembed"
          },
          {
            "kind": "item",
            "label": "Embed All Linked",
            "monetId": "soembedall"
          },
          {
            "kind": "item",
            "label": "Convert to Linked…",
            "monetId": "soconvertlinked"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Stack Mode",
            "monetId": "smartstack"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Rasterize",
            "monetId": "rasterizesmart"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Video Layers",
        "items": [
          {
            "kind": "item",
            "label": "New Video Layer from File…"
          },
          {
            "kind": "item",
            "label": "New Blank Video Layer"
          },
          {
            "kind": "item",
            "label": "Insert Blank Frame"
          },
          {
            "kind": "item",
            "label": "Duplicate Frame"
          },
          {
            "kind": "item",
            "label": "Delete Frame"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Replace Footage…"
          },
          {
            "kind": "item",
            "label": "Interpret Footage…"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Show Altered Video"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Restore Frame"
          },
          {
            "kind": "item",
            "label": "Restore All Frames"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Reload Frame"
          },
          {
            "kind": "item",
            "label": "Rasterize"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Rasterize",
        "items": [
          {
            "kind": "item",
            "label": "Type",
            "monetId": "rasterizetype"
          },
          {
            "kind": "item",
            "label": "Shape",
            "monetId": "rasterizeshape"
          },
          {
            "kind": "item",
            "label": "Fill Content"
          },
          {
            "kind": "item",
            "label": "Vector Mask",
            "monetId": "rasterizevectormask"
          },
          {
            "kind": "item",
            "label": "Smart Object",
            "monetId": "rasterizesmart"
          },
          {
            "kind": "item",
            "label": "Video"
          },
          {
            "kind": "item",
            "label": "Layer Style",
            "monetId": "rasterizelayerstyle"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Layer",
            "monetId": "rasterizelayer"
          },
          {
            "kind": "item",
            "label": "All Layers",
            "monetId": "rasterizealllayers"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "New Layer Based Slice",
        "items": [
          {
            "kind": "item",
            "label": "New Layer Based Slice",
            "monetId": "newlayerbasedslice"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Group Layers",
        "items": [
          {
            "kind": "item",
            "label": "Group Layers",
            "shortcut": "⌘G",
            "monetId": "grp"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Ungroup Layers",
        "items": [
          {
            "kind": "item",
            "label": "Ungroup Layers",
            "shortcut": "⇧⌘G",
            "monetId": "ungrp"
          }
        ]
      },
      {
        "kind": "item",
        "label": "Hide Layers",
        "monetId": "hidelayers"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Arrange",
        "items": [
          {
            "kind": "item",
            "label": "Bring to Front",
            "shortcut": "⇧⌘]",
            "monetId": "arrFront"
          },
          {
            "kind": "item",
            "label": "Bring Forward",
            "shortcut": "⌘]",
            "monetId": "arrFwd"
          },
          {
            "kind": "item",
            "label": "Send Backward",
            "shortcut": "⌘[",
            "monetId": "arrBwd"
          },
          {
            "kind": "item",
            "label": "Send to Back",
            "shortcut": "⇧⌘[",
            "monetId": "arrBack"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Reverse",
            "monetId": "reverselayers"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Combine Shapes",
        "items": [
          {
            "kind": "item",
            "label": "Unite Shapes",
            "monetId": "uniteshapes"
          },
          {
            "kind": "item",
            "label": "Subtract Front Shape",
            "monetId": "subtractfrontshape"
          },
          {
            "kind": "item",
            "label": "Unite Shapes at Overlap",
            "monetId": "uniteshapesoverlap"
          },
          {
            "kind": "item",
            "label": "Subtract Shapes at Overlap",
            "monetId": "subtractshapesoverlap"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Merge Shape Components",
            "monetId": "mergeshapecomponents"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Align",
        "items": [
          {
            "kind": "item",
            "label": "Top Edges",
            "monetId": "aligntop"
          },
          {
            "kind": "item",
            "label": "Vertical Centers",
            "monetId": "alignvc"
          },
          {
            "kind": "item",
            "label": "Bottom Edges",
            "monetId": "alignbottom"
          },
          {
            "kind": "item",
            "label": "Left Edges",
            "monetId": "alignleft"
          },
          {
            "kind": "item",
            "label": "Horizontal Centers",
            "monetId": "alignhc"
          },
          {
            "kind": "item",
            "label": "Right Edges",
            "monetId": "alignright"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Distribute",
        "items": [
          {
            "kind": "item",
            "label": "Top Edges",
            "monetId": "disttop"
          },
          {
            "kind": "item",
            "label": "Vertical Centers",
            "monetId": "distvc"
          },
          {
            "kind": "item",
            "label": "Bottom Edges",
            "monetId": "distbottom"
          },
          {
            "kind": "item",
            "label": "Left Edges",
            "monetId": "distleft"
          },
          {
            "kind": "item",
            "label": "Horizontal Centers",
            "monetId": "disthc"
          },
          {
            "kind": "item",
            "label": "Right Edges",
            "monetId": "distright"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Horizontal",
            "monetId": "disth"
          },
          {
            "kind": "item",
            "label": "Vertical",
            "monetId": "distv"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Lock Layers…",
        "shortcut": "⌘/",
        "monetId": "locklayers"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Link Layers",
        "monetId": "linklayers"
      },
      {
        "kind": "item",
        "label": "Select Linked Layers",
        "monetId": "selectlinkedlayers"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Merge Down",
        "shortcut": "⌘E",
        "monetId": "merge"
      },
      {
        "kind": "item",
        "label": "Merge Visible",
        "shortcut": "⇧⌘E",
        "monetId": "mergevis"
      },
      {
        "kind": "item",
        "label": "Flatten Image",
        "monetId": "flat"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Matting",
        "items": [
          {
            "kind": "item",
            "label": "Color Decontaminate",
            "monetId": "colordecontaminate"
          },
          {
            "kind": "item",
            "label": "Defringe…",
            "monetId": "defringe"
          },
          {
            "kind": "item",
            "label": "Remove Black Matte",
            "monetId": "rmblack"
          },
          {
            "kind": "item",
            "label": "Remove White Matte",
            "monetId": "rmwhite"
          }
        ]
      }
    ]
  },
  {
    "id": "type",
    "label": "Type",
    "tree": [
      {
        "kind": "item",
        "label": "New Text Layer",
        "monetId": "tnew"
      },
      {
        "kind": "item",
        "label": "Edit Text…",
        "monetId": "tedit"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Panels",
        "items": [
          {
            "kind": "item",
            "label": "Character Panel",
            "monetId": "characterpanel"
          },
          {
            "kind": "item",
            "label": "Paragraph Panel",
            "monetId": "paragraphpanel"
          },
          {
            "kind": "item",
            "label": "Glyphs Panel",
            "monetId": "glyphs"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Character Styles Panel",
            "monetId": "charstyles"
          },
          {
            "kind": "item",
            "label": "Paragraph Styles Panel",
            "monetId": "parastyles"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Anti-Alias",
        "items": [
          {
            "kind": "item",
            "label": "None",
            "monetId": "aanone"
          },
          {
            "kind": "item",
            "label": "Sharp",
            "monetId": "aasharp"
          },
          {
            "kind": "item",
            "label": "Crisp",
            "monetId": "aacrisp"
          },
          {
            "kind": "item",
            "label": "Strong",
            "monetId": "aastrong"
          },
          {
            "kind": "item",
            "label": "Smooth",
            "monetId": "aasmooth"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Windows LCD",
            "monetId": "aawindowslcd"
          },
          {
            "kind": "item",
            "label": "Windows",
            "monetId": "aawindows"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Orientation",
        "items": [
          {
            "kind": "item",
            "label": "Horizontal",
            "monetId": "orienth"
          },
          {
            "kind": "item",
            "label": "Vertical",
            "monetId": "orientv"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "OpenType",
        "items": [
          {
            "kind": "item",
            "label": "Standard Ligatures",
            "monetId": "otliga"
          },
          {
            "kind": "item",
            "label": "Contextual Alternates"
          },
          {
            "kind": "item",
            "label": "Discretionary Ligatures",
            "monetId": "otdlig"
          },
          {
            "kind": "item",
            "label": "Swash"
          },
          {
            "kind": "item",
            "label": "Oldstyle"
          },
          {
            "kind": "item",
            "label": "Stylistic Alternates"
          },
          {
            "kind": "item",
            "label": "Titling Alternates"
          },
          {
            "kind": "item",
            "label": "Ordinals",
            "monetId": "otordn"
          },
          {
            "kind": "item",
            "label": "Fractions",
            "monetId": "otfrac"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "submenu",
            "label": "Stylistic Sets",
            "items": [
              {
                "kind": "item",
                "label": "Set 1"
              },
              {
                "kind": "item",
                "label": "Set 2"
              },
              {
                "kind": "item",
                "label": "Set 3"
              },
              {
                "kind": "item",
                "label": "Set 4"
              },
              {
                "kind": "item",
                "label": "Set 5"
              },
              {
                "kind": "item",
                "label": "Set 6"
              },
              {
                "kind": "item",
                "label": "Set 7"
              },
              {
                "kind": "item",
                "label": "Set 8"
              },
              {
                "kind": "item",
                "label": "Set 9"
              },
              {
                "kind": "item",
                "label": "Set 10"
              },
              {
                "kind": "item",
                "label": "Set 11"
              },
              {
                "kind": "item",
                "label": "Set 12"
              },
              {
                "kind": "item",
                "label": "Set 13"
              },
              {
                "kind": "item",
                "label": "Set 14"
              },
              {
                "kind": "item",
                "label": "Set 15"
              },
              {
                "kind": "item",
                "label": "Set 16"
              },
              {
                "kind": "item",
                "label": "Set 17"
              },
              {
                "kind": "item",
                "label": "Set 18"
              },
              {
                "kind": "item",
                "label": "Set 19"
              },
              {
                "kind": "item",
                "label": "Set 20"
              }
            ]
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Justification Alternates"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Create Work Path",
        "monetId": "createworkpath"
      },
      {
        "kind": "item",
        "label": "Convert to Shape",
        "monetId": "converttoshape"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Rasterize Type Layer",
        "monetId": "trast"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Convert to Paragraph Text",
        "monetId": "converttoparagraph"
      },
      {
        "kind": "item",
        "label": "Text on Path",
        "monetId": "textonpath"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Warp Text…",
        "monetId": "twarp"
      },
      {
        "kind": "item",
        "label": "Match Font…",
        "monetId": "matchfont"
      },
      {
        "kind": "item",
        "label": "Match Font (Image AI)…",
        "monetId": "matchfontai"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Font Preview Size",
        "items": [
          {
            "kind": "item",
            "label": "None"
          },
          {
            "kind": "item",
            "label": "Small"
          },
          {
            "kind": "item",
            "label": "Medium"
          },
          {
            "kind": "item",
            "label": "Large"
          },
          {
            "kind": "item",
            "label": "Extra Large"
          },
          {
            "kind": "item",
            "label": "Huge"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Language Options",
        "items": [
          {
            "kind": "item",
            "label": "Default"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "East Asian Features"
          },
          {
            "kind": "item",
            "label": "Middle Eastern Features"
          },
          {
            "kind": "item",
            "label": "Indic Features"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Left-to-Right Text Direction",
            "monetId": "textdirltr"
          },
          {
            "kind": "item",
            "label": "Right-to-Left Text Direction",
            "monetId": "textdirrtl"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Latin Composer",
            "monetId": "composerlatin"
          },
          {
            "kind": "item",
            "label": "World-Ready Composer",
            "monetId": "composerworldready"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Use Latin Digits",
            "monetId": "digitslatin"
          },
          {
            "kind": "item",
            "label": "Use Arabic Digits",
            "monetId": "digitsarabic"
          },
          {
            "kind": "item",
            "label": "Use Hindi Digits",
            "monetId": "digitshindi"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "submenu",
            "label": "Kashidas",
            "items": [
              {
                "kind": "item",
                "label": "None",
                "monetId": "kashidanone"
              },
              {
                "kind": "item",
                "label": "Short",
                "monetId": "kashidashort"
              },
              {
                "kind": "item",
                "label": "Medium",
                "monetId": "kashidamedium"
              },
              {
                "kind": "item",
                "label": "Long",
                "monetId": "kashidalong"
              },
              {
                "kind": "item",
                "label": "Stylistic",
                "monetId": "kashidastylistic"
              }
            ]
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Update All Text Layers",
        "monetId": "updatealltext"
      },
      {
        "kind": "item",
        "label": "Replace All Missing Fonts",
        "monetId": "replacemissingfonts"
      },
      {
        "kind": "item",
        "label": "Resolve Missing Fonts",
        "monetId": "resolvemissingfonts"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Paste Lorem Ipsum",
        "monetId": "pastelorem"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Load Default Type Styles",
        "monetId": "loaddefaulttypestyles"
      },
      {
        "kind": "item",
        "label": "Save Default Type Styles",
        "monetId": "savedefaulttypestyles"
      }
    ]
  },
  {
    "id": "select",
    "label": "Select",
    "tree": [
      {
        "kind": "item",
        "label": "All",
        "shortcut": "⌘A",
        "monetId": "all"
      },
      {
        "kind": "item",
        "label": "Deselect",
        "shortcut": "⌘D",
        "monetId": "none"
      },
      {
        "kind": "item",
        "label": "Reselect",
        "shortcut": "⇧⌘D",
        "monetId": "resel"
      },
      {
        "kind": "item",
        "label": "Inverse",
        "shortcut": "⇧⌘I",
        "monetId": "inv"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "All Layers",
        "shortcut": "⌥⌘A",
        "monetId": "alllayers"
      },
      {
        "kind": "item",
        "label": "Deselect Layers",
        "monetId": "deselectlayers"
      },
      {
        "kind": "item",
        "label": "Find Layers",
        "shortcut": "⌥⇧⌘F",
        "monetId": "findlayers"
      },
      {
        "kind": "item",
        "label": "Isolate Layers",
        "monetId": "isolatelayers"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Color Range…",
        "monetId": "crange"
      },
      {
        "kind": "item",
        "label": "Focus Area…",
        "monetId": "focusarea"
      },
      {
        "kind": "item",
        "label": "Subject",
        "monetId": "subj"
      },
      {
        "kind": "item",
        "label": "Sky"
      },
      {
        "kind": "item",
        "label": "Remove Background (AI)",
        "monetId": "rembg"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Select and Mask…",
        "shortcut": "⌥⌘R",
        "monetId": "selectandmask"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Modify",
        "items": [
          {
            "kind": "item",
            "label": "Border…",
            "monetId": "border"
          },
          {
            "kind": "item",
            "label": "Smooth…",
            "monetId": "smooth"
          },
          {
            "kind": "item",
            "label": "Expand…",
            "monetId": "expand"
          },
          {
            "kind": "item",
            "label": "Contract…",
            "monetId": "contract"
          },
          {
            "kind": "item",
            "label": "Feather…",
            "shortcut": "⇧F6",
            "monetId": "feather"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Grow",
        "monetId": "grow"
      },
      {
        "kind": "item",
        "label": "Similar",
        "monetId": "similar"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Transform Selection…",
        "monetId": "xfsel"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Edit in Quick Mask Mode",
        "monetId": "quickmask"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Load Selection…",
        "monetId": "loadsel"
      },
      {
        "kind": "item",
        "label": "Save Selection…",
        "monetId": "savesel"
      }
    ]
  },
  {
    "id": "filter",
    "label": "Filter",
    "tree": [
      {
        "kind": "item",
        "label": "Last Filter",
        "shortcut": "⌥⌘F",
        "monetId": "lastfilter"
      },
      {
        "kind": "item",
        "label": "Convert for Smart Filters",
        "monetId": "convertsmart"
      },
      {
        "kind": "item",
        "label": "Frequency Separation…",
        "monetId": "freqsep"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Neural Filters",
        "items": [
          {
            "kind": "item",
            "label": "AI Neural Filters (ONNX)…",
            "monetId": "nai"
          },
          {
            "kind": "item",
            "label": "JPEG Artifacts Removal…",
            "monetId": "njpeg"
          },
          {
            "kind": "item",
            "label": "Super Resolution (2×, fast)",
            "monetId": "nsr"
          },
          {
            "kind": "item",
            "label": "AI Denoise…",
            "monetId": "ndenoise"
          },
          {
            "kind": "item",
            "label": "Colorize",
            "monetId": "ncol"
          },
          {
            "kind": "item",
            "label": "Depth Blur (AI)…",
            "monetId": "ndepthblur"
          },
          {
            "kind": "item",
            "label": "Harmonize (AI)…",
            "monetId": "nharmonize"
          },
          {
            "kind": "item",
            "label": "Photo Restoration (AI)…",
            "monetId": "nrestore"
          },
          {
            "kind": "item",
            "label": "Face-Aware Liquify (AI)…",
            "monetId": "nfaceliquify"
          },
          {
            "kind": "item",
            "label": "Skin Smoothing (AI)…",
            "monetId": "nskinsmooth"
          }
        ]
      },
      {
        "kind": "item",
        "label": "Filter Gallery…",
        "monetId": "filtergallery"
      },
      {
        "kind": "item",
        "label": "Adaptive Wide Angle…",
        "shortcut": "⌥⇧⌘A",
        "monetId": "adaptivewide"
      },
      {
        "kind": "item",
        "label": "Camera Raw Filter…",
        "shortcut": "⇧⌘A",
        "monetId": "cameraraw"
      },
      {
        "kind": "item",
        "label": "Lens Correction…",
        "shortcut": "⇧⌘R",
        "monetId": "lenscorrection"
      },
      {
        "kind": "item",
        "label": "Liquify…",
        "shortcut": "⇧⌘X",
        "monetId": "liquify"
      },
      {
        "kind": "item",
        "label": "Vanishing Point…",
        "shortcut": "⌥⌘V",
        "monetId": "vanishingpoint"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Blur",
        "items": [
          {
            "kind": "item",
            "label": "Average",
            "monetId": "avg"
          },
          {
            "kind": "item",
            "label": "Blur",
            "monetId": "blur"
          },
          {
            "kind": "item",
            "label": "Blur More",
            "monetId": "blurmore"
          },
          {
            "kind": "item",
            "label": "Box Blur…",
            "monetId": "bb"
          },
          {
            "kind": "item",
            "label": "Gaussian Blur…",
            "monetId": "gb"
          },
          {
            "kind": "item",
            "label": "Lens Blur…",
            "monetId": "lensblur"
          },
          {
            "kind": "item",
            "label": "Motion Blur…",
            "monetId": "mb"
          },
          {
            "kind": "item",
            "label": "Radial Blur…",
            "monetId": "rdb"
          },
          {
            "kind": "item",
            "label": "Shape Blur…",
            "monetId": "shapeblur"
          },
          {
            "kind": "item",
            "label": "Smart Blur…",
            "monetId": "smb"
          },
          {
            "kind": "item",
            "label": "Surface Blur…",
            "monetId": "sfb"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Blur Gallery",
        "items": [
          {
            "kind": "item",
            "label": "Field Blur…",
            "monetId": "fieldblur"
          },
          {
            "kind": "item",
            "label": "Iris Blur…",
            "monetId": "irisblur"
          },
          {
            "kind": "item",
            "label": "Tilt-Shift…",
            "monetId": "tiltshift"
          },
          {
            "kind": "item",
            "label": "Path Blur…",
            "monetId": "pathblur"
          },
          {
            "kind": "item",
            "label": "Spin Blur…",
            "monetId": "spinblur"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Distort",
        "items": [
          {
            "kind": "item",
            "label": "Diffuse Glow…",
            "monetId": "dglow"
          },
          {
            "kind": "item",
            "label": "Displace…",
            "monetId": "displace"
          },
          {
            "kind": "item",
            "label": "Pinch…",
            "monetId": "dsph"
          },
          {
            "kind": "item",
            "label": "Polar Coordinates…",
            "monetId": "dpolar"
          },
          {
            "kind": "item",
            "label": "Ripple…",
            "monetId": "drip"
          },
          {
            "kind": "item",
            "label": "Ocean Ripple…",
            "monetId": "oceanripple"
          },
          {
            "kind": "item",
            "label": "Glass…",
            "monetId": "glassfilter"
          },
          {
            "kind": "item",
            "label": "Shear…",
            "monetId": "dshr"
          },
          {
            "kind": "item",
            "label": "Spherize…",
            "monetId": "dsph"
          },
          {
            "kind": "item",
            "label": "Twirl…",
            "monetId": "dtwl"
          },
          {
            "kind": "item",
            "label": "Wave…",
            "monetId": "dwave"
          },
          {
            "kind": "item",
            "label": "ZigZag…",
            "monetId": "dzz"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Noise",
        "items": [
          {
            "kind": "item",
            "label": "Add Noise…",
            "monetId": "no"
          },
          {
            "kind": "item",
            "label": "Despeckle",
            "monetId": "dspk"
          },
          {
            "kind": "item",
            "label": "Dust & Scratches…",
            "monetId": "dust"
          },
          {
            "kind": "item",
            "label": "Median…",
            "monetId": "md"
          },
          {
            "kind": "item",
            "label": "Reduce Noise…",
            "monetId": "reducenoise"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Pixelate",
        "items": [
          {
            "kind": "item",
            "label": "Color Halftone…",
            "monetId": "chalf"
          },
          {
            "kind": "item",
            "label": "Crystallize…",
            "monetId": "cryst"
          },
          {
            "kind": "item",
            "label": "Facet",
            "monetId": "facet"
          },
          {
            "kind": "item",
            "label": "Fragment",
            "monetId": "frag"
          },
          {
            "kind": "item",
            "label": "Mezzotint…",
            "monetId": "mezzotint"
          },
          {
            "kind": "item",
            "label": "Mosaic…",
            "monetId": "mo"
          },
          {
            "kind": "item",
            "label": "Pointillize…",
            "monetId": "pointl"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Render",
        "items": [
          {
            "kind": "item",
            "label": "Flame…",
            "monetId": "flame"
          },
          {
            "kind": "item",
            "label": "Picture Frame…",
            "monetId": "pictureframe"
          },
          {
            "kind": "item",
            "label": "Tree…",
            "monetId": "tree"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Clouds",
            "monetId": "clouds"
          },
          {
            "kind": "item",
            "label": "Difference Clouds",
            "monetId": "diffclouds"
          },
          {
            "kind": "item",
            "label": "Fibers…",
            "monetId": "fibers"
          },
          {
            "kind": "item",
            "label": "Lens Flare…",
            "monetId": "lensflare"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Sharpen",
        "items": [
          {
            "kind": "item",
            "label": "Shake Reduction…",
            "monetId": "shakereduction"
          },
          {
            "kind": "item",
            "label": "Sharpen",
            "monetId": "sh"
          },
          {
            "kind": "item",
            "label": "Sharpen Edges",
            "monetId": "she"
          },
          {
            "kind": "item",
            "label": "Sharpen More",
            "monetId": "sharpenmore"
          },
          {
            "kind": "item",
            "label": "Smart Sharpen…",
            "monetId": "smartsharpen"
          },
          {
            "kind": "item",
            "label": "Unsharp Mask…",
            "monetId": "us"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Stylize",
        "items": [
          {
            "kind": "item",
            "label": "Diffuse…",
            "monetId": "diffuse"
          },
          {
            "kind": "item",
            "label": "Emboss…",
            "monetId": "em"
          },
          {
            "kind": "item",
            "label": "Extrude…",
            "monetId": "extrudefilter"
          },
          {
            "kind": "item",
            "label": "Find Edges",
            "monetId": "fe"
          },
          {
            "kind": "item",
            "label": "Oil Paint…",
            "monetId": "noil"
          },
          {
            "kind": "item",
            "label": "Solarize",
            "monetId": "solarize"
          },
          {
            "kind": "item",
            "label": "Tiles…",
            "monetId": "tiles"
          },
          {
            "kind": "item",
            "label": "Trace Contour…",
            "monetId": "tracecontour"
          },
          {
            "kind": "item",
            "label": "Wind…",
            "monetId": "wind"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Glowing Edges…",
            "monetId": "glowedges"
          },
          {
            "kind": "item",
            "label": "Bas Relief…",
            "monetId": "basrelief"
          },
          {
            "kind": "item",
            "label": "Chrome…",
            "monetId": "chrome"
          },
          {
            "kind": "item",
            "label": "Graphic Pen…",
            "monetId": "graphicpen"
          },
          {
            "kind": "item",
            "label": "Halftone Pattern…",
            "monetId": "halftonepattern"
          },
          {
            "kind": "item",
            "label": "Photocopy…",
            "monetId": "photocopy"
          },
          {
            "kind": "item",
            "label": "Stamp…",
            "monetId": "stampfilter"
          },
          {
            "kind": "item",
            "label": "Note Paper…",
            "monetId": "notepaper"
          },
          {
            "kind": "item",
            "label": "Torn Edges…",
            "monetId": "tornedges"
          },
          {
            "kind": "item",
            "label": "Water Paper…",
            "monetId": "waterpaper"
          },
          {
            "kind": "item",
            "label": "Chalk & Charcoal…",
            "monetId": "chalkcharcoal"
          },
          {
            "kind": "item",
            "label": "Charcoal…",
            "monetId": "charcoal"
          },
          {
            "kind": "item",
            "label": "Conté Crayon…",
            "monetId": "contecrayon"
          },
          {
            "kind": "item",
            "label": "Reticulation…",
            "monetId": "reticulation"
          },
          {
            "kind": "item",
            "label": "Plaster…",
            "monetId": "plaster"
          },
          {
            "kind": "item",
            "label": "Poster Edges…",
            "monetId": "posteredges"
          },
          {
            "kind": "item",
            "label": "Cutout…",
            "monetId": "cutout"
          },
          {
            "kind": "item",
            "label": "Dry Brush…",
            "monetId": "drybrush"
          },
          {
            "kind": "item",
            "label": "Watercolor…",
            "monetId": "watercolor"
          },
          {
            "kind": "item",
            "label": "Neon Glow…",
            "monetId": "neonglow"
          },
          {
            "kind": "item",
            "label": "Plastic Wrap…",
            "monetId": "plasticwrap"
          },
          {
            "kind": "item",
            "label": "Film Grain…",
            "monetId": "filmgrain"
          },
          {
            "kind": "item",
            "label": "Crosshatch…",
            "monetId": "crosshatch"
          },
          {
            "kind": "item",
            "label": "Angled Strokes…",
            "monetId": "angledstrokes"
          },
          {
            "kind": "item",
            "label": "Dark Strokes…",
            "monetId": "darkstrokes"
          },
          {
            "kind": "item",
            "label": "Sprayed Strokes…",
            "monetId": "sprayedstrokes"
          },
          {
            "kind": "item",
            "label": "Sumi-e…",
            "monetId": "sumie"
          },
          {
            "kind": "item",
            "label": "Spatter…",
            "monetId": "spatter"
          },
          {
            "kind": "item",
            "label": "Accented Edges…",
            "monetId": "accentededges"
          },
          {
            "kind": "item",
            "label": "Ink Outlines…",
            "monetId": "inkoutlines"
          },
          {
            "kind": "item",
            "label": "Texturizer…",
            "monetId": "texturizer"
          },
          {
            "kind": "item",
            "label": "Stained Glass…",
            "monetId": "stained"
          },
          {
            "kind": "item",
            "label": "Mosaic Tiles…",
            "monetId": "mosaictiles"
          },
          {
            "kind": "item",
            "label": "Patchwork…",
            "monetId": "patchwork"
          },
          {
            "kind": "item",
            "label": "Craquelure…",
            "monetId": "craquelure"
          },
          {
            "kind": "item",
            "label": "Grain…",
            "monetId": "grain"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Video",
        "items": [
          {
            "kind": "item",
            "label": "De-Interlace…",
            "monetId": "deinterlace"
          },
          {
            "kind": "item",
            "label": "NTSC Colors",
            "monetId": "ntsccolors"
          }
        ]
      },
      {
        "kind": "submenu",
        "label": "Other",
        "items": [
          {
            "kind": "item",
            "label": "Custom…",
            "monetId": "custom"
          },
          {
            "kind": "item",
            "label": "High Pass…",
            "monetId": "hp"
          },
          {
            "kind": "item",
            "label": "HSB/HSL",
            "monetId": "hsbhsl"
          },
          {
            "kind": "item",
            "label": "Maximum…",
            "monetId": "maximum"
          },
          {
            "kind": "item",
            "label": "Minimum…",
            "monetId": "minimum"
          },
          {
            "kind": "item",
            "label": "Offset…",
            "monetId": "offset"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Vignette…",
            "monetId": "vg"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Browse Filters Online…",
        "monetId": "browsefilters"
      }
    ]
  },
  {
    "id": "view",
    "label": "View",
    "tree": [
      {
        "kind": "submenu",
        "label": "Proof Setup",
        "items": [
          {
            "kind": "item",
            "label": "Custom…",
            "monetId": "proofsetupcustom"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Working CMYK",
            "monetId": "proofcmyk"
          },
          {
            "kind": "item",
            "label": "Working Cyan Plate",
            "monetId": "proofcyan"
          },
          {
            "kind": "item",
            "label": "Working Magenta Plate",
            "monetId": "proofmagenta"
          },
          {
            "kind": "item",
            "label": "Working Yellow Plate",
            "monetId": "proofyellow"
          },
          {
            "kind": "item",
            "label": "Working Black Plate",
            "monetId": "proofblack"
          },
          {
            "kind": "item",
            "label": "Working CMY Plates",
            "monetId": "proofcmy"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "OCIO ACEScg",
            "monetId": "proofacescg"
          },
          {
            "kind": "item",
            "label": "OCIO ACES2065-1",
            "monetId": "proofaces2065"
          },
          {
            "kind": "item",
            "label": "HDR Display (Rec.2100 PQ)",
            "monetId": "proofhdrpq"
          },
          {
            "kind": "item",
            "label": "HDR Display (Rec.2100 HLG)",
            "monetId": "proofhdrhlg"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Legacy Macintosh RGB (Gamma 1.8)",
            "monetId": "proofgamma18"
          },
          {
            "kind": "item",
            "label": "Internet Standard RGB (sRGB)"
          },
          {
            "kind": "item",
            "label": "Monitor RGB"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Color Blindness — Protanopia-type",
            "monetId": "proofprotanopia"
          },
          {
            "kind": "item",
            "label": "Color Blindness — Deuteranopia-type",
            "monetId": "proofdeuteranopia"
          }
        ]
      },
      {
        "kind": "item",
        "label": "Proof Colors",
        "shortcut": "⌘Y",
        "monetId": "proofcolors"
      },
      {
        "kind": "item",
        "label": "Gamut Warning",
        "shortcut": "⇧⌘Y",
        "monetId": "gamutwarning"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Pixel Aspect Ratio",
        "items": [
          {
            "kind": "item",
            "label": "Custom Pixel Aspect Ratio…",
            "monetId": "custompixelaspect"
          },
          {
            "kind": "item",
            "label": "Delete Pixel Aspect Ratio…"
          },
          {
            "kind": "item",
            "label": "Reset Pixel Aspect Ratios…"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Square",
            "monetId": "parsquare"
          },
          {
            "kind": "item",
            "label": "D1/DV NTSC (0.91)",
            "monetId": "parntsc"
          },
          {
            "kind": "item",
            "label": "D1/DV PAL (1.09)",
            "monetId": "parpal"
          },
          {
            "kind": "item",
            "label": "D1/DV NTSC Widescreen (1.21)",
            "monetId": "parntscwide"
          },
          {
            "kind": "item",
            "label": "HDV 1080/DVCPRO HD 720 (1.33)",
            "monetId": "parhdv"
          },
          {
            "kind": "item",
            "label": "D1/DV PAL Widescreen (1.46)",
            "monetId": "parpalwide"
          },
          {
            "kind": "item",
            "label": "Anamorphic 2:1 (2.0)",
            "monetId": "paranamorphic"
          },
          {
            "kind": "item",
            "label": "DVCPRO HD 1080 (1.5)",
            "monetId": "pardvcpro"
          }
        ]
      },
      {
        "kind": "item",
        "label": "Pixel Aspect Ratio Correction",
        "monetId": "parcorrection"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "32-bit Preview Options…"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Zoom In",
        "shortcut": "⌘+",
        "monetId": "zi"
      },
      {
        "kind": "item",
        "label": "Zoom Out",
        "shortcut": "⌘-",
        "monetId": "zo"
      },
      {
        "kind": "item",
        "label": "Fit on Screen",
        "shortcut": "⌘0",
        "monetId": "fit"
      },
      {
        "kind": "item",
        "label": "Fit Artboard on Screen",
        "monetId": "fit"
      },
      {
        "kind": "item",
        "label": "100%",
        "shortcut": "⌘1",
        "monetId": "actual"
      },
      {
        "kind": "item",
        "label": "200%",
        "monetId": "zoom200"
      },
      {
        "kind": "item",
        "label": "Print Size",
        "monetId": "printsize"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "submenu",
        "label": "Screen Mode",
        "items": [
          {
            "kind": "item",
            "label": "Standard Screen Mode",
            "monetId": "screenstandard"
          },
          {
            "kind": "item",
            "label": "Full Screen Mode With Menu Bar",
            "monetId": "screenfullmenu"
          },
          {
            "kind": "item",
            "label": "Full Screen Mode",
            "monetId": "screenfull"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Extras",
        "shortcut": "⌘H",
        "monetId": "extras"
      },
      {
        "kind": "submenu",
        "label": "Show",
        "items": [
          {
            "kind": "item",
            "label": "Layer Edges",
            "monetId": "layeredges"
          },
          {
            "kind": "item",
            "label": "Selection Edges",
            "monetId": "selectionedges"
          },
          {
            "kind": "item",
            "label": "Target Path",
            "shortcut": "⇧⌘H",
            "monetId": "targetpath"
          },
          {
            "kind": "item",
            "label": "Grid",
            "shortcut": "⌘'",
            "monetId": "showgrid"
          },
          {
            "kind": "item",
            "label": "Guides",
            "shortcut": "⌘;",
            "monetId": "showguides"
          },
          {
            "kind": "item",
            "label": "Canvas Guides",
            "monetId": "showguides"
          },
          {
            "kind": "item",
            "label": "Artboard Guides",
            "monetId": "showguides"
          },
          {
            "kind": "item",
            "label": "Count",
            "monetId": "showcount"
          },
          {
            "kind": "item",
            "label": "Color Samplers",
            "monetId": "showsamplers"
          },
          {
            "kind": "item",
            "label": "Smart Guides",
            "monetId": "smartguides"
          },
          {
            "kind": "item",
            "label": "Slices",
            "monetId": "showslices"
          },
          {
            "kind": "item",
            "label": "Notes",
            "monetId": "shownotes"
          },
          {
            "kind": "item",
            "label": "Pixel Grid",
            "monetId": "pixelgrid"
          },
          {
            "kind": "item",
            "label": "Brush Preview",
            "monetId": "brushpreview"
          },
          {
            "kind": "item",
            "label": "Mesh"
          },
          {
            "kind": "item",
            "label": "Edit Pins"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "All",
            "monetId": "showall"
          },
          {
            "kind": "item",
            "label": "None",
            "monetId": "shownone"
          },
          {
            "kind": "separator"
          },
          {
            "kind": "item",
            "label": "Show Extras Options…",
            "monetId": "showextrasoptions"
          }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Rulers",
        "shortcut": "⌘R",
        "monetId": "rulers"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Snap",
        "shortcut": "⇧⌘;",
        "monetId": "snap"
      },
      {
        "kind": "submenu",
        "label": "Snap To",
        "items": [
          { "kind": "item", "label": "Guides", "monetId": "snapguides" },
          { "kind": "item", "label": "Grid", "monetId": "snapgrid" },
          { "kind": "item", "label": "Document Bounds", "monetId": "snapdocbounds" },
          { "kind": "separator" },
          { "kind": "item", "label": "All", "monetId": "snapall" },
          { "kind": "item", "label": "None", "monetId": "snapnone" }
        ]
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Lock Guides",
        "shortcut": "⌥⌘;",
        "monetId": "lockguides"
      },
      {
        "kind": "item",
        "label": "Clear Guides",
        "monetId": "clearguides"
      },
      {
        "kind": "item",
        "label": "Clear Selected Artboard Guides",
        "monetId": "clearguides"
      },
      {
        "kind": "item",
        "label": "Clear Canvas Guides",
        "monetId": "clearguides"
      },
      {
        "kind": "item",
        "label": "New Guide…",
        "monetId": "newguide"
      },
      {
        "kind": "item",
        "label": "New Guide Layout…",
        "monetId": "newguidelayout"
      },
      {
        "kind": "item",
        "label": "New Guides From Shape",
        "monetId": "guidesfromshape"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Lock Slices",
        "monetId": "lockslices"
      },
      {
        "kind": "item",
        "label": "Clear Slices",
        "monetId": "clearslices"
      },
      {
        "kind": "separator"
      },
      {
        "kind": "item",
        "label": "Pattern Preview",
        "monetId": "patternpreview"
      }
    ]
  }
];
