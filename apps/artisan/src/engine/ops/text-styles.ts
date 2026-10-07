// ops/text-styles - document-backed Character and Paragraph style presets

import { cloneDeep } from "../clone";
import { setPrimaryFill } from "../model/appearance";
import { newId } from "../model/factory";
import { selectionLeaves } from "../model/query";
import { invalidateTextLayout } from "../model/typography";
import type {
  CharacterStyle,
  CharacterStyleAttributes,
  Document,
  ID,
  ParagraphStyle,
  ParagraphStyleAttributes,
  TextItem,
} from "../model/types";

export interface TextStyleMutationOptions {
  id?: ID;
  now?: string;
}

const characterStyles = (doc: Document): CharacterStyle[] => {
  if (!doc.characterStyles) doc.characterStyles = [];
  return doc.characterStyles;
};

const paragraphStyles = (doc: Document): ParagraphStyle[] => {
  if (!doc.paragraphStyles) doc.paragraphStyles = [];
  return doc.paragraphStyles;
};

const textForSelection = (doc: Document, selection: Iterable<ID>): TextItem | null => {
  return selectedTextItems(doc, selection)[0] ?? null;
};

const selectedTextItems = (doc: Document, selection: Iterable<ID>): TextItem[] =>
  selectionLeaves(doc, selection).filter((item): item is TextItem => item.type === "text");

export const captureCharacterAttributes = (text: TextItem): CharacterStyleAttributes => ({
  fontFamily: text.fontFamily,
  fontSize: text.fontSize,
  fontWeight: text.fontWeight,
  fontStyle: text.fontStyle,
  letterSpacing: text.letterSpacing,
  lineHeight: text.lineHeight,
  ...(text.baselineShift !== undefined ? { baselineShift: text.baselineShift } : {}),
  ...(text.horizontalScale !== undefined ? { horizontalScale: text.horizontalScale } : {}),
  ...(text.verticalScale !== undefined ? { verticalScale: text.verticalScale } : {}),
  ...(text.kerning !== undefined ? { kerning: text.kerning } : {}),
  ...(text.underline !== undefined ? { underline: text.underline } : {}),
  ...(text.strikethrough !== undefined ? { strikethrough: text.strikethrough } : {}),
  ...(text.caps !== undefined ? { caps: text.caps } : {}),
  ...(text.language !== undefined ? { language: text.language } : {}),
  ...(text.direction !== undefined ? { direction: text.direction } : {}),
  ...(text.writingMode !== undefined ? { writingMode: text.writingMode } : {}),
  ...(text.glyphOrientation !== undefined ? { glyphOrientation: text.glyphOrientation } : {}),
  ...(text.features?.length ? { features: cloneDeep(text.features) } : {}),
  fill: cloneDeep(text.fill),
});

export const captureParagraphAttributes = (text: TextItem): ParagraphStyleAttributes => ({
  align: text.align,
  lineHeight: text.lineHeight,
  ...(text.spaceBefore !== undefined ? { spaceBefore: text.spaceBefore } : {}),
  ...(text.spaceAfter !== undefined ? { spaceAfter: text.spaceAfter } : {}),
  ...(text.indentLeft !== undefined ? { indentLeft: text.indentLeft } : {}),
  ...(text.indentRight !== undefined ? { indentRight: text.indentRight } : {}),
  ...(text.indentFirst !== undefined ? { indentFirst: text.indentFirst } : {}),
});

export const findCharacterStyle = (doc: Document, styleId: ID): CharacterStyle | undefined =>
  characterStyles(doc).find((style) => style.id === styleId);

export const findParagraphStyle = (doc: Document, styleId: ID): ParagraphStyle | undefined =>
  paragraphStyles(doc).find((style) => style.id === styleId);

export const createCharacterStyleFromSelection = (
  doc: Document,
  selection: Iterable<ID>,
  name: string,
  opts: TextStyleMutationOptions = {},
): ID | null => {
  const text = textForSelection(doc, selection);
  if (!text) return null;
  const list = characterStyles(doc);
  const id = opts.id ?? newId("cstyle");
  list.push({
    id,
    name: name.trim() || `Character Style ${list.length + 1}`,
    attributes: captureCharacterAttributes(text),
    ...(opts.now ? { createdAt: opts.now, updatedAt: opts.now } : {}),
  });
  return id;
};

export const createParagraphStyleFromSelection = (
  doc: Document,
  selection: Iterable<ID>,
  name: string,
  opts: TextStyleMutationOptions = {},
): ID | null => {
  const text = textForSelection(doc, selection);
  if (!text) return null;
  const list = paragraphStyles(doc);
  const id = opts.id ?? newId("pstyle");
  list.push({
    id,
    name: name.trim() || `Paragraph Style ${list.length + 1}`,
    attributes: captureParagraphAttributes(text),
    ...(opts.now ? { createdAt: opts.now, updatedAt: opts.now } : {}),
  });
  return id;
};

const clearCharacterOptionals = (text: TextItem) => {
  delete text.baselineShift;
  delete text.horizontalScale;
  delete text.verticalScale;
  delete text.kerning;
  delete text.underline;
  delete text.strikethrough;
  delete text.caps;
  delete text.language;
  delete text.direction;
  delete text.writingMode;
  delete text.glyphOrientation;
  delete text.features;
};

export const applyCharacterStyle = (doc: Document, selection: Iterable<ID>, styleId: ID): ID[] => {
  const style = findCharacterStyle(doc, styleId);
  if (!style) return [];
  const changed: ID[] = [];
  for (const text of selectedTextItems(doc, selection)) {
    clearCharacterOptionals(text);
    text.fontFamily = style.attributes.fontFamily;
    text.fontSize = style.attributes.fontSize;
    text.fontWeight = style.attributes.fontWeight;
    text.fontStyle = style.attributes.fontStyle;
    text.letterSpacing = style.attributes.letterSpacing;
    text.lineHeight = style.attributes.lineHeight;
    if (style.attributes.baselineShift !== undefined) text.baselineShift = style.attributes.baselineShift;
    if (style.attributes.horizontalScale !== undefined) text.horizontalScale = style.attributes.horizontalScale;
    if (style.attributes.verticalScale !== undefined) text.verticalScale = style.attributes.verticalScale;
    if (style.attributes.kerning !== undefined) text.kerning = style.attributes.kerning;
    if (style.attributes.underline !== undefined) text.underline = style.attributes.underline;
    if (style.attributes.strikethrough !== undefined) text.strikethrough = style.attributes.strikethrough;
    if (style.attributes.caps !== undefined) text.caps = style.attributes.caps;
    if (style.attributes.language !== undefined) text.language = style.attributes.language;
    if (style.attributes.direction !== undefined) text.direction = style.attributes.direction;
    if (style.attributes.writingMode !== undefined) text.writingMode = style.attributes.writingMode;
    if (style.attributes.glyphOrientation !== undefined) text.glyphOrientation = style.attributes.glyphOrientation;
    if (style.attributes.features?.length) text.features = cloneDeep(style.attributes.features);
    if (style.attributes.fill) setPrimaryFill(text, style.attributes.fill);
    text.fontResolution = undefined;
    invalidateTextLayout(text);
    changed.push(text.id);
  }
  return changed;
};

const clearParagraphOptionals = (text: TextItem) => {
  delete text.spaceBefore;
  delete text.spaceAfter;
  delete text.indentLeft;
  delete text.indentRight;
  delete text.indentFirst;
};

export const applyParagraphStyle = (doc: Document, selection: Iterable<ID>, styleId: ID): ID[] => {
  const style = findParagraphStyle(doc, styleId);
  if (!style) return [];
  const changed: ID[] = [];
  for (const text of selectedTextItems(doc, selection)) {
    clearParagraphOptionals(text);
    text.align = style.attributes.align;
    text.lineHeight = style.attributes.lineHeight;
    if (style.attributes.spaceBefore !== undefined) text.spaceBefore = style.attributes.spaceBefore;
    if (style.attributes.spaceAfter !== undefined) text.spaceAfter = style.attributes.spaceAfter;
    if (style.attributes.indentLeft !== undefined) text.indentLeft = style.attributes.indentLeft;
    if (style.attributes.indentRight !== undefined) text.indentRight = style.attributes.indentRight;
    if (style.attributes.indentFirst !== undefined) text.indentFirst = style.attributes.indentFirst;
    invalidateTextLayout(text);
    changed.push(text.id);
  }
  return changed;
};

export const deleteCharacterStyle = (doc: Document, styleId: ID): boolean => {
  const list = characterStyles(doc);
  const idx = list.findIndex((style) => style.id === styleId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
};

export const deleteParagraphStyle = (doc: Document, styleId: ID): boolean => {
  const list = paragraphStyles(doc);
  const idx = list.findIndex((style) => style.id === styleId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
};
