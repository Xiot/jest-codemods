import globby from 'globby'
import process from 'process'

import { executeTransformations } from '../cli/transformers'

const [, , glob] = process.argv

function expandFilePathsIfNeeded(filesBeforeExpansion) {
  const shouldExpandFiles = filesBeforeExpansion.some((file) => file.includes('*'))
  return shouldExpandFiles ? globby.sync(filesBeforeExpansion) : filesBeforeExpansion
}

const filesExpanded = expandFilePathsIfNeeded([glob])

const flags = {
  force: true,
  dry: false,
}
const parser = 'tsx'
const transformers = ['sinon', 'chai-should', 'mocha']
const transformerArgs = []

executeTransformations({
  files: filesExpanded,
  flags: flags,
  parser,
  transformers,
  transformerArgs,
})
