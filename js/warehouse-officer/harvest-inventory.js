
import {
    renderInventoryPage,
    cleanupInventoryPage
} from './inventory-template.js';

/** Render verified harvest inventory through the shared warehouse template. */
export async function render(root, ctx) {
    await renderInventoryPage(root, {
        type: 'harvest',
        title: 'Harvest Inventory',
        description: 'View verified harvest records and manage available warehouse produce.',
        icon: '🌾',
        sections: [
            { label: 'Crop Types' },
            { label: 'Total Verified Quantity' },
            { label: 'Available Stock' },
            { label: 'Verified Harvest Records' }
        ]
    }, ctx);
}

/** Release shared inventory-page resources before navigating away. */
export function cleanup() {
    cleanupInventoryPage();
}
