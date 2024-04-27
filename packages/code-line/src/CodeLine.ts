import Parser from "web-tree-sitter";
import {CompositeDisposable, Disposable} from "./Disposable.ts";

type Complete = {
    offsetStart?: number;
    offsetEnd?: number;
    text: string;
}
type LineEditorOptions = {
    source?: string
    language: Parser.Language
    highlight?: string;
    onCreate?: (selection: Selection, node: Parser.SyntaxNode) => void
};
export type Selection = {
    start: number,
    end: number
};

export class CodeLine implements Disposable {
    private disposables = new CompositeDisposable();
    private parser!: Parser;
    private tree!: Parser.Tree;
    private source: string;
    private selection?: Selection
    private readonly highlightQuery?: Parser.Query;
    private readonly language: Parser.Language;
    private readonly codeArea = document.createElement('div');
    private readonly errorArea = document.createElement('div');
    private readonly completeArea = document.createElement('div');
    onCreate?: (selection: Selection, node: Parser.SyntaxNode) => void;

    private constructor(private ele: HTMLElement, ops: LineEditorOptions) {
        this.source = ops.source ?? '';
        this.language = ops.language;
        try {
            this.highlightQuery = ops.highlight ? ops.language.query(ops.highlight) : undefined;
        } catch (e) {
            console.error(e)
        }
        this.onCreate = ops.onCreate;
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
        this.ele.style.position = 'relative';
        this.ele.style.fontFamily = 'monospace';
        this.ele.style.whiteSpace = 'pre';
    }

    private initCoreArea() {
        this.codeArea.contentEditable = 'true';
        this.codeArea.style.outline = 'none'
        this.codeArea.spellcheck = false;
        this.ele.appendChild(this.codeArea);
    }

    private initErrorArea() {
        this.ele.appendChild(this.errorArea);
    }

    private initCompleteArea() {
        this.ele.appendChild(this.completeArea);
    }

    async init() {
        await Parser.init();
        this.parser = new Parser();
        this.parser.setLanguage(this.language);

        this.initRoot();
        this.initCoreArea();
        this.initErrorArea();
        this.initCompleteArea();

        this.listenInput();
        this.listenSelectionChange();

        this.sourceChange(this.source);
    }


    listenInput() {
        const listener = () => {
            this.sourceChange(this.codeArea.innerText);
        };
        this.ele.addEventListener('input', listener)
        this.disposables.add(() => {
            this.ele.removeEventListener('input', listener)
        })
    }

    listenSelectionChange() {
        document.addEventListener('selectionchange', this.selectionChange)
        this.disposables.add(() => {
            document.removeEventListener('selectionchange', this.selectionChange)
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

    private selectionChange = () => {
        const selection = window.getSelection();
        if (selection?.rangeCount) {
            const range = selection.getRangeAt(0);
            const getOffset = (node: Node) => {
                const codeNode = node.parentElement?.closest('[data-code-node]');
                return codeNode ? parseInt(codeNode.getAttribute('data-offset') ?? '0') : 0;
            }
            const startOffset = getOffset(range.startContainer);
            const endOffset = getOffset(range.endContainer);
            this.selection = {
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

    setSelection(start: number, end: number) {
        this.selection = {
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

    getError = (node: Parser.SyntaxNode): Parser.SyntaxNode[] => {
        const result: Parser.SyntaxNode[] = []
        if (node.isError) {
            result.push(node)
        }
        if (node.hasError) {
            result.push(...node.children.flatMap(this.getError))
        }
        return result;
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
        this.selectionChange();
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
        const errors = this.getError(this.tree.rootNode);
        this.errorArea.innerHTML = '';
        for (const error of errors) {
            const range = this.selectionToRange(error.startIndex, error.endIndex);
            if (range) {
                for (const rect of range.getClientRects()) {
                    const div = document.createElement('div');
                    div.style.position = 'absolute';
                    div.style.left = `${rect.left}px`;
                    div.style.top = `${rect.top + rect.height - 1}px`;
                    div.style.width = `${rect.width}px`;
                    div.style.height = `1px`;
                    div.style.backgroundColor = 'red';
                    this.errorArea.appendChild(div);
                }
            }
        }
        this.closeComplete();
        if (this.selection && this.selection.start === this.selection.end) {
            const node = this.findSyntaxNode(this.selection.start);
            if (node) {
                this.onCreate?.(this.selection, node)
            }
        }
    }

    openComplete(start: number, end: number, list: Complete[]) {
        for (const item of list) {
            const div = document.createElement('div');
            div.innerText = item.text;
            div.style.cursor = 'pointer';
            div.style.padding = '4px';
            div.style.border = '1px solid #ccc';
            div.style.borderRadius = '4px';
            div.style.margin = '4px';
            div.addEventListener('click', () => {
                const realStart = start + (item.offsetStart ?? 0);
                const realEnd = end + (item.offsetEnd ?? 0);
                this.replaceText(realStart, realEnd, item.text);
                this.completeArea.innerHTML = '';
            })
            this.completeArea.appendChild(div);
        }
    }

    closeComplete() {
        this.completeArea.innerHTML = '';
    }

    replaceText(start: number, end: number, text: string) {
        this.sourceChange(this.source.slice(0, start) + text + this.source.slice(end))
        this.setSelection(start + text.length, start + text.length)
    }
}

