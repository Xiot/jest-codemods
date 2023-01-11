import { NodePath } from '@babel/core'
import core, { API, ASTPath, Collection, FileInfo, Identifier } from 'jscodeshift'
import { AstPath } from 'prettier'
import * as recast from 'recast'
import { inspect } from 'util'

// import type {Scope} from 'ast-types/node-path';
import { findImports } from '../../utils/imports'

const SANDBOX_FN_MAP = {
  spy: 'fn',
  mock: 'stubAll',
  restore: 'dispose',
  stub: 'stub',
  replaceGetter: 'stubGet',
}

function createSandboxWithOptions({ j }: IContext, p: ASTPath) {
  const beforeEach = j(p).closest(j.CallExpression, {
    callee: {
      type: 'Identifier',
      name: 'beforeEach',
    },
  })

  const args =
    beforeEach.length > 0
      ? [
          j.objectExpression([
            j.objectProperty(j.identifier('autoCleanup'), j.booleanLiteral(false)),
          ]),
        ]
      : []

  return j.callExpression(j.identifier('createSandbox'), args)
}

function replaceSandboxImport(ctx: IContext) {
  const { j, ast } = ctx

  let localCreateSandboxName: string | undefined

  // Remove 'createSandbox' import from 'sinon'
  ctx.sinonImport
    .find(j.ImportSpecifier, {
      imported: {
        type: 'Identifier',
        name: 'createSandbox',
      },
    })
    .forEach((p) => {
      localCreateSandboxName = p.get('local', 'name')?.value
      p.prune()
    })

  let isSandboxUsed = false

  if (localCreateSandboxName) {
    ast
      .find(j.CallExpression, {
        callee: {
          type: 'Identifier',
          name: localCreateSandboxName,
        },
      })
      .replaceWith((p) => {
        isSandboxUsed = true
        return createSandboxWithOptions(ctx, p)
      })
  }

  const defaultImport = ctx.sinonImport.find(j.ImportDefaultSpecifier)
  if (defaultImport.length > 0) {
    const sinonName = defaultImport.get('local', 'name').value

    ast
      .find(j.CallExpression, {
        callee: {
          type: 'MemberExpression',
          object: {
            type: 'Identifier',
            name: sinonName,
          },
          property: {
            type: 'Identifier',
            name: 'createSandbox',
          },
        },
      })
      .replaceWith((p) => {
        isSandboxUsed = true
        return createSandboxWithOptions(ctx, p)
      })
  }

  if (isSandboxUsed) {
    // Add the new 'createSandbox' import
    ctx.sinonImport.insertAfter(
      j.importDeclaration(
        [j.importSpecifier(j.identifier('createSandbox'))],
        j.literal('bolt/tests/utils/sandbox')
      )
    )
  }
}

function getSandboxVariables(ctx: IContext): Collection<Identifier> {
  const { j, ast } = ctx

  const identifiers = ast
    .find(j.CallExpression, {
      callee: {
        type: 'Identifier',
        name: 'createSandbox',
      },
    })
    .map((path) => {
      if (path.parentPath.node.type === 'VariableDeclarator') {
        return path.parentPath.get('id')
      } else if (path.parentPath.node.type === 'AssignmentExpression') {
        return path.parentPath.get('left')
      }
      return path.node
    })

  return identifiers as Collection<Identifier>
}
function findDeclaringScope(id: ASTPath<Identifier>) {
  const name = id.getValueProperty('name')
  let { scope } = id
  while (scope && !scope.declares(name)) {
    scope = scope.parent
  }
  return scope
}

function replaceSandboxMethods(ctx: IContext, id: ASTPath<Identifier>) {
  const declaringScope = findDeclaringScope(id)

  const { j } = ctx
  j(declaringScope.path)
    .find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        object: {
          type: 'Identifier',
          name: id.getValueProperty('name'),
        },
      },
    })
    .replaceWith((p) => {
      const propertyName = p.get('callee', 'property', 'name').value
      const targetName = SANDBOX_FN_MAP[propertyName]
      if (!targetName) return p.node

      const args = p.node.arguments
      const object = getValue<Identifier>(p, 'callee', 'object')

      // No args, just call `jest.fn()`
      if (args.length === 0) {
        return j.callExpression(
          j.memberExpression(j.identifier('jest'), j.identifier('fn')),
          []
        )
      }

      const sandboxMethod = j.callExpression(
        j.memberExpression(object, j.identifier(targetName)),
        p.node.arguments.slice(0, 2)
      )

      if (args.length <= 2) {
        return sandboxMethod
      }

      return j.callExpression(
        j.memberExpression(sandboxMethod, j.identifier('mockImplementation')),
        args.slice(-1)
      )
    })
}
function getValue<T>(path: ASTPath, ...names: (string | number)[]): T {
  return path.get(...names).value
}

function transformObjectStubs(ctx: IContext, id: ASTPath<Identifier>) {
  const { j } = ctx

  j(id.scope.path)
    .find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        object: {
          type: 'CallExpression',
          callee: {
            type: 'MemberExpression',
            property: {
              type: 'Identifier',
              name: 'expects',
            },
          },
        },
        property: {
          type: 'Identifier',
          name: 'once',
        },
      },
    })
    .replaceWith((path) => {
      return path.get('callee', 'object').value
    })

  j(id.scope.path)
    .find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        object: {
          type: 'Identifier',
        },
        property: {
          type: 'Identifier',
          name: 'expects',
        },
      },
    })
    .replaceWith((path) => {
      const mock = path.get('callee', 'object').value
      const name = path.get('arguments', 0).value.value
      return j.memberExpression(mock, j.identifier(name))
    })
}

export function transformSandbox(j: core.JSCodeshift, ast: Collection<any>) {
  const ctx = getContext(j, ast)
  if (!ctx) {
    console.log('no sinon')
    return
  }

  replaceSandboxImport(ctx)
  const ids = getSandboxVariables(ctx)
  ids.forEach((id) => {
    replaceSandboxMethods(ctx, id)
    transformObjectStubs(ctx, id)
  })

  // getUsages(ctx, ids.paths()[0])

  // const f = ast.find(j.CallExpression, {
  //   callee: ctx.createSandboxFilter,
  // })
  // // f.forEach((p) => logNode(p))
  // // f.forEach((path) => {
  // //   console.log('scope', path.parent)
  // // })

  // f.replaceWith((p) => {
  //   return j.callExpression(j.identifier('createSandbox'), [])
  // })

  // let foundSandbox = false
  // const sandboxNode = ast
  //   .find(j.MemberExpression, {
  //     object: {
  //       type: 'Identifier',
  //       name: 'sinon',
  //     },
  //     property: {
  //       type: 'Identifier',
  //       name: 'createSandbox',
  //     },
  //   })
  //   .replaceWith((node) => {
  //     foundSandbox = true
  //     return j.identifier('createSandbox')
  //   })

  // if (!foundSandbox) return

  // if (!sandboxNode) return
  // const sandboxDeclaration = sandboxNode.closest(j.VariableDeclarator).paths()[0]
  // if (!sandboxDeclaration) return
  // const sandboxIdentifier =
  //   sandboxDeclaration.node.id.type === 'Identifier' && sandboxDeclaration.node.id.name
  // if (!sandboxIdentifier) return

  // // Add `import createSandbox from 'bolt/tests/utils/sandbox'`
  // const importStatement = j.importDeclaration(
  //   [j.importSpecifier(j.identifier('createSandbox'))],
  //   j.literal('bolt/tests/utils/sandbox')
  // )
  // ast.find(j.Program).get('body', 0).insertBefore(importStatement)

  // ast
  //   .find(j.MemberExpression, {
  //     object: {
  //       type: 'Identifier',
  //       name: sandboxIdentifier,
  //     },
  //     property: {
  //       type: 'Identifier',
  //       name: (name) => Object.hasOwn(SANDBOX_FN_MAP, name),
  //     },
  //   })
  //   .replaceWith((path) => {
  //     const propertyName = (path.node.property as core.Identifier).name
  //     return j.memberExpression(
  //       path.node.object,
  //       j.identifier(SANDBOX_FN_MAP[propertyName])
  //     )
  //   })
}

interface IContext {
  j: core.JSCodeshift
  ast: Collection<any>
  sinonImport: Collection<core.ImportDeclaration>

  // createSandboxFilter:
  //   | {
  //       type: 'Identifier'
  //       name: string
  //     }
  //   | {
  //       type: 'MemberExpression'
  //       object: {
  //         type: 'Identifier'
  //         name: string
  //       }
  //       property: {
  //         type: 'Identifier'
  //         name: 'createSandbox'
  //       }
  //     }
  // isSinonSandbox(node: core.ASTPath): boolean
}

function getContext(j: core.JSCodeshift, ast: Collection<any>): IContext | null {
  const packageImport: Collection<core.ImportDeclaration> = findImports(j, ast, 'sinon')
  if (packageImport.length === 0) return null

  return {
    j,
    ast,
    sinonImport: packageImport,

    // createSandboxFilter: matchFilter,
    // isSinonSandbox: (node: core.ASTPath) => {
    //   return j.match(node, matchFilter)
    // },
  }

  // console.log(debug(sinonImport.node))

  // let foundSandbox = false
  // const sandboxNode = ast
  //   .find(j.MemberExpression, {
  //     object: {
  //       type: 'Identifier',
  //       name: 'sinon',
  //     },
  //     property: {
  //       type: 'Identifier',
  //       name: 'createSandbox',
  //     },
  //   })
  //   .replaceWith((node) => {
  //     foundSandbox = true
  //     return j.identifier('createSandbox')
  //   })

  // if (!foundSandbox) return

  // if (!sandboxNode) return
  // const sandboxDeclaration = sandboxNode.closest(j.VariableDeclarator).paths()[0]
  // if (!sandboxDeclaration) return
  // const sandboxIdentifier =
  //   sandboxDeclaration.node.id.type === 'Identifier' && sandboxDeclaration.node.id.name
  // if (!sandboxIdentifier) return

  // return {
  //   sandboxIdentifier,
  // }
}

function closest(node: core.ASTPath, target: core.ASTNode['type']) {
  let current = node
  while (current.node.type !== target) {
    current = current.parentPath
    if (current == null) return null
  }
  return current
}
const hiddenKeys = ['tokens', 'lines']
function logNode(node: core.ASTNode | core.ASTPath) {
  const obj = 'node' in node ? node.node : node
  const text = JSON.stringify(
    obj,
    (k, v) => (!v || hiddenKeys.includes(k) ? undefined : v),
    2
  )
  // console.log('node', text)
}
function debug(node: core.ASTNode | core.ASTPath | Collection<any>) {
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
