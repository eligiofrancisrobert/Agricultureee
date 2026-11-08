import { h, toast, pageHead } from './ui.js';
import { getSettings, saveSettings } from './api.js';

const OPTIONS = [
    ['requireApproval', 'Require approval', 'New accounts wait in the queue until an admin approves them.'],
    ['allowFarmer', 'Open farmer registration', 'Let new farmers submit an application.'],
    ['allowBuyer', 'Open buyer registration', 'Let new buyers submit an application.'],
    ['allowSupplier', 'Open supplier registration', 'Let new suppliers submit an application.'],
    ['maintenance', 'Maintenance mode', 'Only admins can sign in while this is on.'],
];

/** Render registration and maintenance settings and save changed checkbox values. */
export async function render(root) {
    const settings = await getSettings();

    const row = ([key, title, hint]) =>
        h('li', {},
            h('div', {}, h('p', {}, title), h('small', {}, hint)),
            h('label', { class: 'switch' },
                h('input', { type: 'checkbox', name: key, checked: settings[key], 'aria-label': title }),
                h('span')));

    const form = h('form', {
        onsubmit: async (e) => {
            e.preventDefault();
            const values = Object.fromEntries(OPTIONS.map(([k]) => [k, form.elements[k].checked]));
            await saveSettings(values);
            toast('Settings saved');
        },
    },
        h('ul', { class: 'settings-list' }, OPTIONS.map(row)),
        h('div', { class: 'save-row' }, h('button', { class: 'btn', type: 'submit' }, 'Save changes')));

    root.append(
        pageHead('Settings', 'Control who can register and when the site is open.'),
        h('section', { class: 'card' }, form));
}
