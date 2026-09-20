export function validateInput(value) {
  if (typeof value !== 'object' || value === null) throw new Error('input is required');
  return { name: String(value.name ?? '') };
}
