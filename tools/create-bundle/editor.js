// Source of /create-editor.js: the TipTap editor (MIT) plus the few extras the Create tab needs.
// Build with ./build.sh; the result is a single file that sets window.CrEditor.
import { Editor, Node, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import Image from '@tiptap/extension-image';

// A manual page break: a dashed line on screen, a new page in Word and in the PDF.
const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() { return [{ tag: 'div[data-page-break]' }]; },
  renderHTML() { return ['div', { 'data-page-break': '', class: 'cr-pb' }]; },
  addCommands() {
    return { setPageBreak: () => ({ chain }) => chain().insertContent([{ type: this.name }, { type: 'paragraph' }]).run() };
  },
  addKeyboardShortcuts() { return { 'Mod-Enter': () => this.editor.commands.setPageBreak() }; }
});

// Line spacing and indent on paragraphs and headings (Word stores both on the paragraph).
const TYPES = ['paragraph', 'heading'];
const IND = 1.27; // cm per indent step, as in Word
const ParaFormat = Extension.create({
  name: 'paraFormat',
  priority: 50,
  addGlobalAttributes() {
    return [{ types: TYPES, attributes: {
      lineHeight: { default: null, parseHTML: e => e.style.lineHeight || null, renderHTML: a => (a.lineHeight ? { style: `line-height:${a.lineHeight}` } : {}) },
      indent: { default: 0, parseHTML: e => { const m = parseFloat(e.style.marginLeft); return m > 0 ? Math.min(8, Math.round(m / IND)) : 0; },
        renderHTML: a => (a.indent ? { style: `margin-left:${(a.indent * IND).toFixed(2)}cm` } : {}) }
    } }];
  },
  addCommands() {
    const each = (state, tr, fn) => {
      const { from, to } = state.selection;
      state.doc.nodesBetween(from, to, (node, pos) => { if (TYPES.includes(node.type.name)) { tr.setNodeMarkup(pos, undefined, fn(node.attrs)); return false; } });
      return true;
    };
    return {
      setLineHeight: v => ({ state, tr }) => each(state, tr, a => ({ ...a, lineHeight: v })),
      indent: dir => ({ editor, state, tr }) => {
        const item = editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null;
        if (item) return dir > 0 ? editor.commands.sinkListItem(item) : editor.commands.liftListItem(item);
        if (editor.isActive('table')) return false;
        return each(state, tr, a => ({ ...a, indent: Math.max(0, Math.min(8, (a.indent || 0) + dir)) }));
      }
    };
  },
  addKeyboardShortcuts() {
    return { Tab: () => this.editor.commands.indent(1), 'Shift-Tab': () => this.editor.commands.indent(-1) };
  }
});

// Images live in private storage: the node keeps the storage path, and src holds a short-lived signed link
// that the app refreshes whenever a document opens. Width is a share of the line; align is left, center or right.
const DocImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      path: { default: null, parseHTML: e => e.getAttribute('data-path'), renderHTML: a => (a.path ? { 'data-path': a.path } : {}) },
      width: { default: '100%', parseHTML: e => e.style.width || e.getAttribute('data-width') || '100%', renderHTML: a => ({ 'data-width': a.width, style: `width:${a.width}` }) },
      align: { default: 'center', parseHTML: e => e.getAttribute('data-align') || 'center', renderHTML: a => ({ 'data-align': a.align }) }
    };
  }
}).configure({ inline: false, allowBase64: false, HTMLAttributes: { class: 'cr-img' } });

const imagesIn = list => [...(list || [])].filter(f => /^image\//.test(f.type));

function make(element, content, { onUpdate, onSelection, placeholder, onFiles } = {}) {
  return new Editor({
    element,
    content,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } } }),
      TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: TYPES }),
      Subscript, Superscript,
      TableKit.configure({ table: { resizable: true, cellMinWidth: 40 } }),
      TaskList, TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder || 'Start writing…' }),
      CharacterCount,
      PageBreak, ParaFormat, DocImage
    ],
    editorProps: {
      handlePaste: (view, event) => { const f = imagesIn(event.clipboardData && event.clipboardData.files); if (!f.length || !onFiles) return false; onFiles(f, null); return true; },
      handleDrop: (view, event, slice, moved) => {
        if (moved) return false;
        const f = imagesIn(event.dataTransfer && event.dataTransfer.files); if (!f.length || !onFiles) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        event.preventDefault(); onFiles(f, at ? at.pos : null); return true;
      }
    },
    onUpdate: ({ editor }) => onUpdate && onUpdate(editor),
    onSelectionUpdate: ({ editor }) => onSelection && onSelection(editor),
    onTransaction: ({ editor }) => onSelection && onSelection(editor)
  });
}

window.CrEditor = { make };
