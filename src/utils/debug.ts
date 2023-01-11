import type { ASTNode, ASTPath, Collection } from 'jscodeshift'
import * as recast from 'recast'

const hiddenKeys = ['tokens', 'lines']

export function logNode(node: ASTNode | ASTPath) {
  const obj = 'node' in node ? node.node : node
  const text = JSON.stringify(
    obj,
    (k, v) => (!v || hiddenKeys.includes(k) ? undefined : v),
    2
  )
  console.log('node', text)
}

export function debug(node: ASTNode | ASTPath | Collection<any>) {
  if (!node) {
    return 'NODE IS NULL'
  }
  if ('at' in node) {
    return recast.print(node.nodes()[0]).code
  }
  if ('node' in node) {
    return recast.print(node.node).code
  } else {
    return recast.print(node).code
  }
}
