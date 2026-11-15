
import {
    renderInventoryPage,
    cleanupInventoryPage
} from './inventory-template.js';

/** Render the equipment inventory using the shared warehouse page template. */
export async function render(root, ctx) {
    await renderInventoryPage(root, {
        title: 'Equipment',
        description: 'Monitor agricultural equipment and its current availability.',
        icon: '🚜',
        category: 'Equipment',
        sections: [
            { label: 'Total Equipment' },
            { label: 'Available Equipment' },
            { label: 'Equipment In Use' },
            { label: 'Under Maintenance' }
        ]
    }, ctx);
}

/** Release shared inventory-page resources before navigating away. */
export function cleanup() {
    cleanupInventoryPage();
}
