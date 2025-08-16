//  Figma plugin main
figma.showUI(__html__, { width: 520, height: 480 });

async function safeLoadFontForTextNode(textNode) {
  try {
    const fontName = textNode.fontName;
    if (!fontName) return;
    if (fontName === figma.mixed || fontName.style === undefined) {
      // fallback to default
      await figma.loadFontAsync({ family: "Inter", style: "Regular" }).catch(() => {});
    } else {
      await figma.loadFontAsync(fontName);
    }
  } catch (err) {

  }
}

function findProductTextNodesOnPage(productName) {
  const page = figma.currentPage;
  const lower = productName.trim().toLowerCase();
  return page.findAll(node => {
    if (node.type !== "TEXT") return false;
    const txt = (node.characters || "").trim().toLowerCase();
    // exact full-string match OR contains as separate word
    if (txt === lower) return true;
    // word boundary check
    const regex = new RegExp(`\\b${escapeRegExp(lower)}\\b`);
    return regex.test(txt);
  });
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findPriceNodeForProductNode(productNode) {

  const parent = productNode.parent;
  if (parent && parent.type !== "PAGE") {
    const siblings = parent.children.filter(n => n.type === "TEXT" && n !== productNode);
    if (siblings.length) {
  
      let best = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const s of siblings) {
        const dy = Math.abs(s.y - productNode.y);
        const dx = s.x - productNode.x;
        const score = dy + Math.max(0, -dx) * 10; 
        if (score < bestScore) {
          bestScore = score;
          best = s;
        }
      }
      if (best) return best;
    }
  }

  const page = figma.currentPage;
  const cand = page.findAll(n => n.type === "TEXT" && n !== productNode);
  const yTol = 8;
  const valid = cand.filter(n => Math.abs(n.y - productNode.y) <= yTol && (n.x - productNode.x) > -4);
  if (valid.length) {
 
    valid.sort((a, b) => (a.x - productNode.x) - (b.x - productNode.x));
    return valid[0];
  }

  let nearest = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const n of cand) {
    const dx = n.x - productNode.x;
    const dy = Math.abs(n.y - productNode.y);
    if (dx >= -40) { 
      const dist = Math.hypot(dx, dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = n;
      }
    }
  }
  return nearest;
}

function buildPriceString(existingText, newNumeric) {

  const n = ("" + newNumeric).trim();
  if (n.length === 0) return existingText;
  return "₹" + n;
}

async function updatePricesFromMapping(mapping) {
  let updates = 0;
  let notFound = [];

  for (const productNameRaw of Object.keys(mapping)) {
    const productName = ("" + productNameRaw).trim();
    const newPriceRaw = mapping[productNameRaw];
    const newPrice = ("" + newPriceRaw).trim();

    if (!productName) continue;

    const productNodes = findProductTextNodesOnPage(productName);
    if (!productNodes || productNodes.length === 0) {
      notFound.push(productName);
      continue;
    }

    for (const pNode of productNodes) {
      const priceNode = findPriceNodeForProductNode(pNode);
      if (!priceNode) {
        continue;
      }
    
      await safeLoadFontForTextNode(priceNode);
      try {
        priceNode.characters = buildPriceString(priceNode.characters || "", newPrice);
        updates++;
      } catch (err) {
        
        try {
          await figma.loadFontAsync({ family: "Inter", style: "Regular" }).catch(() => {});
          priceNode.fontName = { family: "Inter", style: "Regular" };
          priceNode.characters = buildPriceString(priceNode.characters || "", newPrice);
          updates++;
        } catch (e) {
     
        }
      }
    }
  }

  return { updates, notFound };
}

async function exportNodeAsPNGBase64(node) {
  const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
 
  let binary = "";
  const buff = bytes;
  const len = buff.length;
  const chunk = 0x8000;
  let i = 0;
  while (i < len) {
    const sub = buff.subarray(i, Math.min(i + chunk, len));
    binary += String.fromCharCode.apply(null, sub);
    i += chunk;
  }
  const b64 = figma.base64Encode(bytes);
  return b64;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "update-prices") {

    const mapping = msg.data || {};
    figma.ui.postMessage({ type: "status", text: "Updating prices..." });

    const res = await updatePricesFromMapping(mapping);
    const reply = {
      type: "update-complete",
      updates: res.updates,
      notFound: res.notFound
    };
    figma.ui.postMessage(reply);
  }

  if (msg.type === "export-png") {
    
    let nodeToExport = null;
    if (figma.currentPage.selection.length > 0) {
      nodeToExport = figma.currentPage.selection[0];
    } else {

      const frames = figma.currentPage.findAll(n => n.type === "FRAME" || n.type === "GROUP");
      let best = null;
      let bestScore = -1;
      for (const f of frames) {
        const textCount = f.findAll(n => n.type === "TEXT").length;
        if (textCount > bestScore) {
          bestScore = textCount;
          best = f;
        }
      }
      if (best && best.type && best.findAll) nodeToExport = best;
    }

    if (!nodeToExport) {
      figma.ui.postMessage({ type: "export-failed", text: "No node selected and no suitable frame found to export." });
      return;
    }

    figma.ui.postMessage({ type: "status", text: "Exporting PNG..." });
    try {
      const b64 = await exportNodeAsPNGBase64(nodeToExport);
      figma.ui.postMessage({ type: "export-ready", data: b64 });
    } catch (err) {
      figma.ui.postMessage({ type: "export-failed", text: err.message || String(err) });
    }
  }

  if (msg.type === "ping") {
    figma.ui.postMessage({ type: "pong" });
  }

  // Close plugin if requested
  if (msg.type === "close") {
    figma.closePlugin();
  }
};
