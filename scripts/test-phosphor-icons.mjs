// scripts/test-phosphor-icons.mjs

import * as icons from "@phosphor-icons/react/dist/ssr";

const availableIcons = Object.keys(icons).sort();

console.log("Total icons:", availableIcons.length);
console.log(availableIcons.join("\n"));