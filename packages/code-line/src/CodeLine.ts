import Parser from "web-tree-sitter";
import {CompositeDisposable, Disposable} from "./Disposable.ts";
import {Widget} from "./widget/Widget.ts";
import {Emitter} from "./Emitter.ts";

type LineEditorOptions = {
    source?: string
    language: Parser.Language
    highlight?: string;
    widgets?: Widget[]
};
export type Selection = {
    start: number,
    end: number
};

export class CodeLine implements Disposable {
    private disposables = new CompositeDisposable();
    private widgets = new Set<Widget>();
    private parser!: Parser;
    private _tree!: Parser.Tree;
    public get tree() {
        return this._tree;
    }

    private set tree(value: Parser.Tree) {
        this._tree = value;
    }

    private source: string;
    private _selection?: Selection
    private readonly highlightQuery?: Parser.Query;
    public readonly language: Parser.Language;
    private readonly codeArea = document.createElement('div');
    events = {
        beforeChange: new Emitter<void>(),
        afterChange: new Emitter<void>()
    }

    private constructor(public root: HTMLElement, ops: LineEditorOptions) {
        this.source = ops.source ?? '';
        this.language = ops.language;
        try {
            this.highlightQuery = ops.highlight ? ops.language.query(ops.highlight) : undefined;
        } catch (e) {
            console.error(e)
        }
        this.widgets = new Set(ops.widgets ?? []);
    }

    dispose() {
        this.disposables.dispose();
    }

    static async create(ele: HTMLElement, ops: LineEditorOptions) {
        const editor = new CodeLine(ele, ops)
        await editor.init();
        return editor;
    }

    private initRoot() {
        this.root.style.position = 'relative';
        this.root.style.fontFamily = 'monospace';
        this.root.style.whiteSpace = 'pre';
    }

    private initCodeArea() {
        this.codeArea.contentEditable = 'true';
        this.codeArea.style.outline = 'none'
        this.codeArea.spellcheck = false;
        this.root.appendChild(this.codeArea);
    }

    async init() {
        await Parser.init();
        this.parser = new Parser();
        this.parser.setLanguage(this.language);

        this.initRoot();
        this.initCodeArea();
        this.listenInput();
        this.listenSelectionChange();

        this.sourceChange(this.source);
        this.widgets.forEach(v => v.init(this));
    }


    listenInput() {
        const listener = () => {
            this.sourceChange(this.codeArea.innerText);
        };
        this.root.addEventListener('input', listener)
        this.disposables.add(() => {
            this.root.removeEventListener('input', listener)
        })
    }

    listenSelectionChange() {
        document.addEventListener('selectionchange', this.fromSelectionChange)
        this.disposables.add(() => {
            document.removeEventListener('selectionchange', this.fromSelectionChange)
        })
    }

    selectionToRange = (startIndex: number, endIndex: number): Range | undefined => {
        const range = document.createRange();
        const start = this.findNode(startIndex);
        const end = this.findNode(endIndex);
        if (start && end) {
            range.setStart(start.node, start.index);
            range.setEnd(end.node, end.index);
            return range;
        }
    }

    private fromSelectionChange = () => {
        const selection = window.getSelection();
        if (selection?.rangeCount) {
            const range = selection.getRangeAt(0);
            const getOffset = (node: Node) => {
                const codeNode = node.parentElement?.closest('[data-code-node]');
                return codeNode ? parseInt(codeNode.getAttribute('data-offset') ?? '0') : 0;
            }
            const startOffset = getOffset(range.startContainer);
            const endOffset = getOffset(range.endContainer);
            this._selection = {
                start: startOffset + range.startOffset,
                end: endOffset + range.endOffset
            }
        }
    }

    findNode(index: number): {
        node: Node;
        index: number
    } | undefined {
        for (const child of this.codeArea.children) {
            const offset = parseInt(child.getAttribute('data-offset') ?? '0');
            if (offset <= index && offset + (child.textContent?.length ?? 0) >= index) {
                return {
                    node: child.firstChild as Node,
                    index: index - offset
                };
            }
        }
    }

    restoreSelection() {
        if (this.selection) {
            const range = this.selectionToRange(this.selection.start, this.selection.end);
            if (range) {
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
            }
        }
    }

    public get selection() {
        return this._selection;
    }

    public setSelection(start: number, end: number) {
        this._selection = {
            start,
            end
        }
        this.restoreSelection();
    }

    sourceChange(newText: string, change?: {
        start: number,
        newEnd: number,
        oldEnd: number
    }) {
        this.events.beforeChange.emit();
        this.source = newText;
        if (change) {
            this.tree = this.tree.edit({
                startIndex: change.start,
                oldEndIndex: change.oldEnd,
                newEndIndex: change.newEnd,
                startPosition: {row: 0, column: change.start},
                oldEndPosition: {row: 0, column: change.oldEnd},
                newEndPosition: {row: 0, column: change.newEnd},
            });
            this.tree = this.parser.parse(this.source, this.tree);
        } else {
            this.tree = this.parser.parse(this.source);
        }
        this.renderTree();
    }

    findSyntaxNode = (index: number) => {
        let lastNode: Parser.SyntaxNode | undefined;
        const find = (index: number, cursor: Parser.TreeCursor) => {
            if (cursor.startIndex < index) {
                lastNode = cursor.currentNode;
                if (cursor.currentNode.childCount > 0) {
                    cursor.gotoFirstChild();
                    find(index, cursor);
                    return
                }
                const findNext = (cursor: Parser.TreeCursor) => {
                    if (cursor.currentNode.nextSibling) {
                        cursor.gotoNextSibling();
                        find(index, cursor);
                        return
                    }
                    if (cursor.currentNode.parent) {
                        cursor.gotoParent();
                        findNext(cursor);
                        return
                    }
                }
                findNext(cursor);
            }
        }
        const cursor = this.tree.walk();
        find(index, cursor)
        return lastNode;
    }

    getHighlight() {
        const map = new Map<Parser.SyntaxNode, string[]>()
        const matches = this.highlightQuery?.matches(this.tree.rootNode);
        matches?.forEach(v => v.captures.forEach(v => {
            if (!map.has(v.node)) {
                map.set(v.node, [v.name])
            } else {
                map.get(v.node)?.push(v.name)
            }
        }));
        return [...map.entries()].sort(([a], [b]) => a.startIndex - b.startIndex)
    }

    renderTree() {
        const highlight = this.getHighlight();
        const result: {
            names: string[],
            text: string
            offset: number
        }[] = []
        let source = this.source;
        let index = 0;
        for (const [node, names] of highlight) {
            const pre = source.slice(0, node.startIndex - index);
            const text = source.slice(node.startIndex - index, node.endIndex - index);
            source = source.slice(node.endIndex - index);
            if (pre) {
                result.push({
                    names: [],
                    text: pre,
                    offset: index,
                })
            }
            index = node.endIndex
            if (text) {
                result.push({
                    names,
                    text,
                    offset: node.startIndex,
                })
            }
        }
        if (source) {
            result.push({
                names: [],
                text: source,
                offset: index,
            })
        }
        this.fromSelectionChange();
        this.codeArea.innerHTML = '';
        for (const {names, text, offset} of result) {
            const node = document.createElement('span');
            node.appendChild(document.createTextNode(text));
            node.classList.add(...names);
            node.setAttribute('data-offset', offset.toString())
            node.setAttribute('data-code-node', true.toString())
            this.codeArea.appendChild(node)
        }
        this.restoreSelection();
        this.events.afterChange.emit();
    }

    replaceText(start: number, end: number, text: string) {
        this.sourceChange(this.source.slice(0, start) + text + this.source.slice(end))
        this.setSelection(start + text.length, start + text.length)
    }
}

