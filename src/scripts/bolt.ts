import fs from 'fs'
import globby from 'globby'
import path from 'path'
import process from 'process'

import { executeTransformations } from '../cli/transformers'

const [, , glob] = process.argv

function expandFilePathsIfNeeded(filesBeforeExpansion) {
  const shouldExpandFiles = filesBeforeExpansion.some((file) => file.includes('*'))
  return shouldExpandFiles
    ? globby.sync(filesBeforeExpansion)
    : globby.sync(`${filesBeforeExpansion}**/*Test.{ts,tsx}`)
}

const filesExpanded = expandFilePathsIfNeeded([glob])
if (filesExpanded.length === 0) {
  console.log('no files found')
  process.exit(0)
}

const flags = {
  force: true,
  dry: false,
}
const parser = 'tsx'
const transformers = ['sinon', 'chai-should', 'mocha']
// const transformers = ['sinon']
const transformerArgs = [...process.argv.filter((a) => a.startsWith('--'))].filter(
  Boolean
)

executeTransformations({
  files: filesExpanded,
  flags: flags,
  parser,
  transformers,
  transformerArgs,
})

filesExpanded.forEach((name) => {
  const newName = name.replace(/Test\.tsx?$/, `.test${path.extname(name)}`)
  console.log(newName)
  if (newName.toLowerCase() === name.toLowerCase()) return
  fs.renameSync(name, newName)
})
