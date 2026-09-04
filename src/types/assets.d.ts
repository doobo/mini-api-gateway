declare module "*.html" {
  // Bun types HTML imports as HTMLBundle at runtime; text content is what we get here.
  const content: string & { __htmlBundle?: never };
  export default content;
}

declare module "*.js" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}
