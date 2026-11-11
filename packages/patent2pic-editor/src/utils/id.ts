let counter = 0

export function generateId(prefix: string = 'id'): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

export function generateNodeId(): string {
  return generateId('n')
}

export function generateEdgeId(): string {
  return generateId('e')
}

export function generateGroupId(): string {
  return generateId('g')
}
