import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { ASTUtils } from '../../utils/ast-utils'
import { createRule } from '../../utils/create-rule'
import { uniqueBy } from '../../utils/unique-by'

const QUERY_KEY = 'queryKey'
const QUERY_FN = 'queryFn'

export const name = 'exhaustive-deps'

export const rule = createRule({
  name,
  meta: {
    type: 'problem',
    docs: {
      description: 'Prefer object syntax for useQuery',
      recommended: 'error',
    },
    messages: {
      missingDeps: `The following dependencies are missing in your queryKey: {{deps}}`,
      fixTo: 'Fix to {{result}}',
    },
    hasSuggestions: true,
    fixable: 'code',
    schema: [],
  },
  defaultOptions: [],

  create(context) {
    return {
      Property(node) {
        if (
          node.parent === undefined ||
          !ASTUtils.isObjectExpression(node.parent) ||
          !ASTUtils.isIdentifierWithName(node.key, QUERY_KEY)
        ) {
          return
        }

        const scopeManager = context.getSourceCode().scopeManager
        const queryKey = ASTUtils.findPropertyWithIdentifierKey(
          node.parent.properties,
          QUERY_KEY,
        )
        const queryFn = ASTUtils.findPropertyWithIdentifierKey(
          node.parent.properties,
          QUERY_FN,
        )

        if (
          scopeManager === null ||
          queryKey === undefined ||
          queryFn === undefined ||
          queryFn.value.type !== AST_NODE_TYPES.ArrowFunctionExpression
        ) {
          return
        }

        let queryKeyNode = queryKey.value

        if (queryKeyNode.type === AST_NODE_TYPES.Identifier) {
          const expression = ASTUtils.getReferencedExpressionByIdentifier({
            context,
            node: queryKeyNode,
          })

          if (expression?.type === AST_NODE_TYPES.ArrayExpression) {
            queryKeyNode = expression
          }
        }

        if (queryKeyNode.type !== AST_NODE_TYPES.ArrayExpression) {
          // TODO support query key factory
          return
        }

        const sourceCode = context.getSourceCode()
        const queryKeyValue = queryKeyNode
        const refs = ASTUtils.getExternalRefs({
          scopeManager,
          node: queryFn.value,
        })

        const relevantRefs = refs.filter((ref) => {
          return (
            ref.identifier.name !== 'undefined' &&
            ref.resolved?.defs.every((def) => def.type !== 'ClassName')
          )
        })

        const existingKeys = ASTUtils.getNestedIdentifiers(queryKeyValue).map(
          (identifier) => ASTUtils.mapKeyNodeToText(identifier, sourceCode),
        )

        const missingRefs = relevantRefs
          .map((ref) => ({
            ref: ref,
            text: ASTUtils.mapKeyNodeToText(ref.identifier, sourceCode),
          }))
          .filter(({ ref, text }) => {
            return (
              !ref.isTypeReference &&
              !ASTUtils.isAncestorIsCallee(ref.identifier) &&
              !existingKeys.some((existingKey) => existingKey === text)
            )
          })
          .map(({ ref, text }) => ({
            identifier: ref.identifier,
            text: text,
          }))

        const uniqueMissingRefs = uniqueBy(missingRefs, (x) => x.text)

        if (uniqueMissingRefs.length > 0) {
          const missingAsText = uniqueMissingRefs
            .map((ref) => ASTUtils.mapKeyNodeToText(ref.identifier, sourceCode))
            .join(', ')

          const existingWithMissing = sourceCode
            .getText(queryKeyValue)
            .replace(/\]$/, `, ${missingAsText}]`)

          context.report({
            node: node,
            messageId: 'missingDeps',
            data: {
              deps: uniqueMissingRefs.map((ref) => ref.text).join(', '),
            },
            suggest: [
              {
                messageId: 'fixTo',
                data: { result: existingWithMissing },
                fix(fixer) {
                  return fixer.replaceText(queryKeyValue, existingWithMissing)
                },
              },
            ],
          })
        }
      },
    }
  },
})
