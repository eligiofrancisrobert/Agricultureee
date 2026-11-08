
import {
    renderInventoryPage,
    cleanupInventoryPage
} from './inventory-template.js';

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

export function cleanup() {
    cleanupInventoryPage();
}
