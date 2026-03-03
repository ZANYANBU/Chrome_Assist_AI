// ZANYSURF Perception Engine

/**
 * Retrieves the full Accessibility Tree (AXTree) for the given tab using chrome.debugger.
 */
export async function getAXTree(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId: tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      chrome.debugger.sendCommand({ tabId: tabId }, "Accessibility.getFullAXTree", {}, (result) => {
        chrome.debugger.detach({ tabId: tabId });
        resolve(result);
      });
    });
  });
}

/**
 * Parses the highly detailed AXTree into a simplified YAML-like or JSON representation
 * that an LLM can easily consume, filtering for actionable semantic roles.
 */
export function simplifyAXTree(axTreeData) {
  if (!axTreeData || !axTreeData.nodes) return "No elements detected.";
  
  const actionableRoles = new Set(['button', 'link', 'input', 'textbox', 'checkbox', 'radio', 'combobox', 'searchbox']);
  const simplified = [];

  for (const node of axTreeData.nodes) {
    const role = node.role?.value;
    if (role && actionableRoles.has(role)) {
      const nameProp = node.properties?.find(p => p.name === 'name');
      const name = nameProp ? nameProp.value.value : 'Unnamed';
      
      simplified.push({
        id: node.nodeId,
        role: role,
        name: name
      });
    }
  }

  // Convert to simplistic YAML-like text for token efficiency
  let output = "Interactive Elements:\n";
  simplified.forEach(item => {
    output += `- [ID: ${item.id}] ${item.role.toUpperCase()}: "${item.name}"\n`;
  });
  
  return output;
}