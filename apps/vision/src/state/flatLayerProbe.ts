/** Engine methods the flat-save predicate reads, for test doubles.
 *
 *  A stand-in that only implements `layer_count` is not a flat document:
 *  missing opacity, visibility, and depth read as 0 and the save is refused.
 */
export function flatLayerProbe(): Record<string, () => unknown> {
  return {
    layer_id_at: () => 1,
    layer_kind: () => 0,
    layer_visible: () => true,
    layer_blend: () => 0,
    layer_opacity: () => 1,
    layer_fill_opacity: () => 1,
    layer_has_mask: () => false,
    has_vector_mask: () => false,
    layer_has_effects: () => false,
    smart_filter_count: () => 0,
    layer_has_transparency: () => false,
    doc_mode: () => 0,
    doc_depth: () => 8,
    document_channel_count: () => 0,
    spot_channel_count: () => 0,
    frame_count: () => 0,
    history_labels: () => [],
    artboard_ids: () => [],
  };
}
