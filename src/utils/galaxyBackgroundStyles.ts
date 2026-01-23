/**
 * Galaxy Background Styles Utility
 * Provides CSS styles to make page backgrounds transparent when galaxy background is enabled
 */

export function applyGalaxyBackgroundStyles() {
  const main = document.querySelector("main[data-galaxy-background='true']");
  
  if (main) {
    // Find the content wrapper
    const contentWrapper = main.querySelector(".galaxy-background-content");
    if (contentWrapper) {
      // Find all direct child divs (page roots)
      const pageRoots = Array.from(contentWrapper.children) as HTMLElement[];
      pageRoots.forEach((pageRoot) => {
        if (pageRoot && pageRoot.tagName === "DIV") {
          // Get current style
          const currentStyle = pageRoot.getAttribute("style") || "";
          // Check if it has a background-color
          if (currentStyle.includes("background-color") || currentStyle.includes("backgroundColor")) {
            // Remove background-color from inline styles
            let newStyle = currentStyle
              .replace(/background-color\s*:\s*[^;]+;?/gi, "")
              .replace(/background\s*:\s*[^;]+;?/gi, "")
              .replace(/backgroundColor\s*:\s*[^,}]+[,}]?/gi, "");
            // Add transparent background
            if (!newStyle.includes("background-color: transparent")) {
              newStyle = (newStyle.trim() + " background-color: transparent !important;").trim();
            }
            pageRoot.setAttribute("style", newStyle);
          } else {
            // Add transparent background if it doesn't have one
            const newStyle = (currentStyle.trim() + " background-color: transparent !important;").trim();
            pageRoot.setAttribute("style", newStyle);
          }
        }
      });
    }
  }
}
