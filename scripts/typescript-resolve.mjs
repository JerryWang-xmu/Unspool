export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      specifier.endsWith(".js") &&
      (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file:"))
    ) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
