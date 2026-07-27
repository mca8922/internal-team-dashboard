// Dev-only route to preview the (app)/error.tsx boundary on demand — visiting
// this page always throws, which Next.js routes straight into the sibling
// error.tsx in this same route group. Not linked from any nav; open it
// directly at /error-preview. Safe to delete once you're done reviewing —
// it renders nothing on its own, it only exists to trigger the boundary.
export default function ErrorPreviewPage(): never {
  throw new Error('Preview error — this page always throws on purpose.');
}
