
import {
    renderInventoryPage,
    cleanupInventoryPage
} from './inventory-template.js';

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

export function cleanup() {
    cleanupInventoryPage();
}
