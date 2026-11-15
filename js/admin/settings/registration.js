
import { h, toast, pageHead } from '../ui.js';
import { getSettings, saveSettings } from '../api.js';

const OPTIONS = [
    [
        'requireApproval',
        'Require approval',
        'New accounts wait in the queue until an admin approves them.'
    ],
    [
        'allowFarmer',
        'Open farmer registration',
        'Let new farmers submit an application.'
    ],
    [
        'allowBuyer',
        'Open buyer registration',
        'Let new buyers submit an application.'
    ],
    [
        'allowSupplier',
        'Open supplier registration',
        'Let new suppliers submit an application.'
    ],
    [
        'maintenance',
        'Maintenance mode',
        'Only admins can sign in while this is on.'
    ],
];

/**
 * Render registration and maintenance settings.
 */
export async function render(root) {
    const settings = await getSettings();

    const createOption = ([key, title, description]) => {
        return h(
            'li',
            {},
            h(
                'div',
                {},
                h('p', {}, title),
                h('small', {}, description)
            ),
            h(
                'label',
                { class: 'switch' },
                h('input', {
                    type: 'checkbox',
                    name: key,
                    checked: Boolean(settings[key]),
                    'aria-label': title
                }),
                h('span')
            )
        );
    };

    const form = h(
        'form',
        {
            onsubmit: async (event) => {
                event.preventDefault();

                const submitButton = form.querySelector(
                    'button[type="submit"]'
                );

                if (submitButton.disabled) return;

                submitButton.disabled = true;
                submitButton.textContent = 'Saving...';

                try {
                    const values = Object.fromEntries(
                        OPTIONS.map(([key]) => [
                            key,
                            form.elements[key].checked
                        ])
                    );

                    await saveSettings(values);

                    toast('Registration settings saved.');
                } catch (error) {
                    console.error(
                        'Failed to save registration settings:',
                        error
                    );

                    toast('Unable to save registration settings.');
                } finally {
                    submitButton.disabled = false;
                    submitButton.textContent = 'Save changes';
                }
            }
        },
        h(
            'ul',
            { class: 'settings-list' },
            OPTIONS.map(createOption)
        ),
        h(
            'div',
            { class: 'save-row' },
            h(
                'button',
                {
                    class: 'btn',
                    type: 'submit'
                },
                'Save changes'
            )
        )
    );

    root.append(
        pageHead(
            'Registration Settings',
            'Manage account registration, application approval, and maintenance mode.'
        ),
        h(
            'section',
            { class: 'card' },
            form
        )
    );
}
