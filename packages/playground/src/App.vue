<script setup lang="ts">
import {CodeLine} from "code-line";
import {onMounted, ref} from "vue";
import Parser from "web-tree-sitter";
import testLangUrl from './tree-sitter-test.wasm?url';

const editor = ref<HTMLElement | null>(null);
let line: CodeLine;
const variableList = [
  'column1',
  'column2',
  'column3',
  'column4',
]
const functionList = [
  'max',
  'min',
  'abs',
  'sqrt',
  'pow',
  'length',
  'normalize',
  'slice'
]
onMounted(async () => {
  if (editor.value) {
    await Parser.init()
    line = await CodeLine.create(editor.value, {
      source: '',
      language: await Parser.Language.load(testLangUrl),
      highlight: `
      (number) @number
      (string) @string
      (boolean) @boolean
      (dot_expression "." @operator)
      (identifier) @keyword
      `,
      onCreate(selection, node) {
        if (node.type === 'identifier') {
          return [...variableList, ...functionList].filter(v => v.startsWith(node.text)).map(v => ({
            text: v,
            offsetStart: node.startIndex - selection.start,
            offsetEnd: node.endIndex - selection.end,
          }));
        }
        if (node.type === '.') {
          return functionList.map(v => ({text: v}))
        }
        return []
      },
    })
  }
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
