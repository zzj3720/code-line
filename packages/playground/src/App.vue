<script setup lang="ts">
import {CodeLine, Selection, widgetPresets} from "code-line";
import {onMounted, onUnmounted, ref} from "vue";
import Parser, {SyntaxNode} from "web-tree-sitter";
import testLangUrl from './tree-sitter-test.wasm?url';

const editor = ref<HTMLElement | null>(null);
let line: CodeLine;
const variableList = [
  'column1',
  'column2',
  'column3',
  'column4',
  'JSON',
  'true',
  'false',
  'window',
  'console',
]
const functionList = [
  'max',
  'min',
  'abs',
  'sqrt',
  'pow',
  'length',
  'normalize',
  'slice',
  'parse',
]
const buildComplete = (options: string[], selection: Selection, node: SyntaxNode) => {
  return options.filter(filter(node.text)).map(v => ({
    text: v,
    offsetStart: node.startIndex - selection.start,
    offsetEnd: node.endIndex - selection.end,
  }));
}
const filter = (text: string) => (s: string) => {
  return s.startsWith(text) && text != s
}
onMounted(async () => {
  if (editor.value) {
    await Parser.init()
    line = await CodeLine.create(editor.value, {
      source: '',
      language: await Parser.Language.load(testLangUrl),
      highlight: `
      (binary_expression operator:_ @operator)
      (number) @number
      (string) @string
      (boolean) @boolean
      (dot_expression "." @operator)
      (identifier) @keyword
      `,
      widgets: [
        new widgetPresets.CodeErrorWidget(),
        new widgetPresets.CodeCompleteWidget({
          matches: [
            {
              query: '(dot_expression function:(_) @function)',
              run: (selection, name, node) => buildComplete(functionList, selection, node)
            },
            {
              query: '(expression) @exp',
              run: (selection, name, node) => buildComplete([...variableList, ...functionList], selection, node)
            },
          ],
        })
      ]
    })
  }
})
onUnmounted(() => {
  line.dispose()
})
</script>
<template>
  <div ref="editor" class="editor"
       style="outline: none;border-radius: 4px;border:1px solid gray;padding: 8px 8px;"></div>
</template>

<style>
.editor {
  font-family: monospace;
}

.keyword {
  color: #990000;
}

.string {
  color: #008080;
}

.number {
  color: #dfa040;
}

.operator {
  color: green;
}

.boolean {
  color: blue;
}
</style>
