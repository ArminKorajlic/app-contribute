// Copies text and says whether it worked: the clipboard may be missing or
// refuse access, and a "Copied" tick must never show for a failed copy.
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
