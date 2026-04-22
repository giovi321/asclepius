import { visit } from 'unist-util-visit';

export default function remarkMermaid() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || node.lang !== 'mermaid') return;
      const escaped = node.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      parent.children.splice(index, 1, {
        type: 'html',
        value: `<pre class="mermaid" style="background:transparent;border:0;padding:0;">${escaped}</pre>`,
      });
    });
  };
}
