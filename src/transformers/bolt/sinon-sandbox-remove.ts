import { NodePath } from '@babel/core'
import core, { API, ASTPath, Collection, FileInfo, Identifier } from 'jscodeshift'
import { AstPath } from 'prettier'
import * as recast from 'recast'
import { inspect } from 'util'

import { findImports } from '../../utils/imports'

export function transformSandbox(j: core.JSCodeshift, ast: Collection<any>) {
  const ctx = getContext(j, ast)
}

interface IContext {
  j: core.JSCodeshift
  ast: Collection<any>
  sinonImport: Collection<core.ImportDeclaration>
}

function getContext(j: core.JSCodeshift, ast: Collection<any>): IContext | null {
  const packageImport: Collection<core.ImportDeclaration> = findImports(j, ast, 'sinon')
  if (packageImport.length === 0) return null

  return {
    j,
    ast,
    sinonImport: packageImport,
  }
}
