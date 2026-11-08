import { h, table, person, select, toast, pageHead } from './ui.js';
import { getLookups, listStaff, createStaff, updateStaff, deleteStaffPermanently, friendlyError } from './staff-api.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function openModal(id, label, ...kids) {
    document.getElementById(id)?.remove();
    const dialog = h('dialog', { id, class: 'details staff-dialog', 'aria-label': label }, ...kids);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
}

const STATUS_UI = {
    active: ['active', 'Active'],
    inactive: ['rejected', 'Inactive'],
    suspended: ['staff-suspended', 'Suspended'],
    deleted: ['staff-deleted', 'Deleted'],
};
const statusBadge = (a) => {
    const [cls, label] = STATUS_UI[a.status] ?? ['', a.status];
    return h('span', { class: `badge ${cls}` }, label);
};

function openForm({ account, roles, statuses, isDuplicate, onSave }) {
    const editing = Boolean(account);

    const nameIn = h('input', {
        type: 'text',
        name: 'name',
        value: account?.name ?? '',
        autocomplete: 'off',
        'aria-required': 'true'
    });

    const emailIn = h('input', {
        type: 'email',
        name: 'email',
        value: account?.email ?? '',
        autocomplete: 'off',
        'aria-required': 'true'
    });

    const passwordIn = h('input', {
        type: 'password',
        name: 'password',
        autocomplete: 'new-password',
        'aria-required': 'true'
    });

    const passwordToggle = h('button', {
        type: 'button',
        class: 'password-toggle',
        'aria-label': 'Show password',
        'aria-pressed': 'false',
        onclick: () => {
            const showPassword = passwordIn.type === 'password';

            passwordIn.type = showPassword ? 'text' : 'password';
            passwordToggle.textContent = showPassword ? 'Hide' : 'Show';
            passwordToggle.setAttribute(
                'aria-label',
                showPassword ? 'Hide password' : 'Show password'
            );
            passwordToggle.setAttribute('aria-pressed', String(showPassword));
        }
    }, 'Show');

    const passwordControl = h(
        'div',
        { class: 'password-field' },
        passwordIn,
        passwordToggle
    );

    const roleSel = h('select', {
        name: 'role',
        'aria-required': 'true'
    },
        h('option', { value: '', selected: !account }, 'Select a role'),
        roles.map((r) => h('option', {
            value: String(r.id),
            selected: r.id === account?.roleId
        }, r.name))
    );

    const defaultStatus = account?.statusId ??
        statuses.find((s) => s.name.toLowerCase() === 'active')?.id;

    const statusSel = h('select', { name: 'status' },
        statuses.map((s) => h('option', {
            value: String(s.id),
            selected: s.id === defaultStatus
        }, s.name))
    );

    const fields = {
        name: nameIn,
        email: emailIn,
        ...(!editing ? {
            password: passwordIn,
            role: roleSel
        } : {}),
        status: statusSel,
    };

    const errEls = Object.fromEntries(
        Object.keys(fields).map((k) => [
            k,
            h('small', { class: 'err', hidden: true })
        ])
    );

    const formError = h('p', {
        class: 'msg error',
        role: 'alert',
        hidden: true
    });

    const field = (key, label) =>
        h('label', {},
            label,
            key === 'password' ? passwordControl : fields[key],
            errEls[key]
        );

    const showErrors = (errors, summary) => {
        for (const k of Object.keys(fields)) {
            const msg = errors[k];

            errEls[k].textContent = msg ?? '';
            errEls[k].hidden = !msg;
            fields[k].setAttribute('aria-invalid', String(Boolean(msg)));
        }

        const text = summary ??
            (Object.keys(errors).length
                ? 'Please fix the highlighted fields and try again.'
                : '');

        formError.textContent = text;
        formError.hidden = !text;
    };

    const validate = (v) => {
        const errors = {};

        if (!v.name) {
            errors.name = 'Full name is required.';
        } else if (v.name.length < 2) {
            errors.name = 'Full name must be at least 2 characters.';
        }

        if (!v.email) {
            errors.email = 'Email address is required.';
        } else if (!EMAIL_RE.test(v.email)) {
            errors.email = 'Enter a valid email address, like name@example.com.';
        } else if (isDuplicate(v.email, account?.id)) {
            errors.email = 'Another staff account already uses this email.';
        }

        if (!editing) {
            if (!v.password) {
                errors.password = 'Password is required.';
            } else {
                const passwordPolicy = [
                    {
                        test: v.password.length >= 12,
                        message: 'Password must be at least 12 characters long.'
                    },
                    {
                        test: /[a-z]/.test(v.password),
                        message: 'Password must contain at least one lowercase letter.'
                    },
                    {
                        test: /[A-Z]/.test(v.password),
                        message: 'Password must contain at least one uppercase letter.'
                    },
                    {
                        test: /\d/.test(v.password),
                        message: 'Password must contain at least one number.'
                    },
                    {
                        test: /[^A-Za-z0-9]/.test(v.password),
                        message: 'Password must contain at least one special character.'
                    }
                ];

                const failedRule = passwordPolicy.find(rule => !rule.test);

                if (failedRule) {
                    errors.password = failedRule.message;
                }
            }

            if (!v.roleId) {
                errors.role = 'Please choose a role.';
            } else if (!roles.some((r) => r.id === v.roleId)) {
                errors.role = 'Choose one of the listed roles.';
            }
        }

        if (!statuses.some((s) => s.id === v.statusId)) {
            errors.status = 'Choose a valid status.';
        }

        return errors;
    };

    const submit = h('button', {
        class: 'btn',
        type: 'submit'
    }, editing ? 'Save changes' : 'Add account');

    const form = h('form', {
        novalidate: true,
        class: 'staff-form',

        onsubmit: async (e) => {
            e.preventDefault();

            if (submit.disabled) return;

            const values = {
                name: nameIn.value.trim().replace(/\s+/g, ' '),
                email: emailIn.value.trim().toLowerCase(),
                statusId: Number(statusSel.value) || null,
                ...(!editing ? {
                    roleId: Number(roleSel.value) || null,
                    password: passwordIn.value
                } : {})
            };

            const errors = validate(values);

            showErrors(errors);

            if (Object.keys(errors).length) {
                toast('Could not save. Check the form for errors.');
                fields[Object.keys(errors)[0]].focus();
                return;
            }

            submit.disabled = true;
            submit.textContent = 'Saving...';

            try {
                await onSave(values);
                dialog.close();
            } catch (err) {
                console.error('Saving staff account failed:', err);

                const msg = friendlyError(err);

                showErrors({}, msg);
                toast(msg);

                submit.disabled = false;
                submit.textContent = editing ? 'Save changes' : 'Add account';
            }
        }
    },
        formError,
        field('name', 'Full name'),
        field('email', 'Email address'),
        ...(!editing ? [
            field('password', 'Password (min. 15 characters)'),
            field('role', 'Role')
        ] : []),
        field('status', 'Account status'),
        h('div', { class: 'staff-buttons' },
            h('button', {
                class: 'btn ghost',
                type: 'button',
                onclick: () => dialog.close()
            }, 'Cancel'),
            submit)
    );

    const dialog = openModal(
        'staffFormDialog',
        editing ? 'Edit staff account' : 'Add staff account',
        h('div', { class: 'card-head' },
            h('h2', {}, editing ? 'Edit staff account' : 'Add staff account')
        ),
        form
    );

    nameIn.focus();
}
function confirmDelete(account, onConfirm) {
    const confirmBtn = h('button', { class: 'btn danger', type: 'button' }, 'Delete account');
    const dialog = openModal('staffDeleteDialog', 'Confirm delete',
        h('div', { class: 'card-head' }, h('h2', {}, 'Delete account?')),
        h('p', {}, `${account.name} (${account.email}) will be marked as deleted and hidden from the list. You can restore it later from the "Deleted" status filter.`),
        h('div', { class: 'staff-buttons' },
            h('button', { class: 'btn ghost', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
            confirmBtn));
    confirmBtn.addEventListener('click', async () => {
        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting...';
        await onConfirm();
        dialog.close();
    });
}

function confirmPermanentDelete(account, onConfirm, seconds = 5) {
    const confirmBtn = h('button', { class: 'btn danger', type: 'button', disabled: true }, `Delete permanently (${seconds})`);
    const dialog = openModal('staffPurgeDialog', 'Confirm permanent delete',
        h('div', { class: 'card-head' }, h('h2', {}, 'Delete permanently?')),
        h('p', {}, `${account.name} (${account.email}) will be erased for good, along with their sign-in login if they have one. This can't be undone.`),
        h('div', { class: 'staff-buttons' },
            h('button', { class: 'btn ghost', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
            confirmBtn));

    let left = seconds;
    const timer = setInterval(() => {
        left -= 1;
        if (left > 0) {
            confirmBtn.textContent = `Delete permanently (${left})`;
        } else {
            clearInterval(timer);
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Delete permanently';
        }
    }, 1000);
    dialog.addEventListener('close', () => clearInterval(timer));

    confirmBtn.addEventListener('click', async () => {
        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting...';
        const ok = await onConfirm();
        if (ok) dialog.close();
        else { confirmBtn.disabled = false; confirmBtn.textContent = 'Delete permanently'; }
    });
}

export async function render(root, ctx) {

    let lookups = { roles: [], statuses: [] };
    let accounts = [];
    const filter = { role: 'all', status: 'current' };

    const holder = h('div');
    const count = h('p', { class: 'muted staff-count' });
    const toolbar = h('div', { class: 'toolbar' });

    const search = h('input', {
        type: 'search', class: 'staff-search', placeholder: 'Search name or email',
        'aria-label': 'Search staff by name or email', value: ctx?.query ?? '',
        oninput: () => draw(),
    });

    const statusIdFor = (key) => lookups.statuses.find((s) => s.name.toLowerCase() === key)?.id;

    const draw = () => {
        const q = search.value.trim().toLowerCase();
        const rows = accounts.filter((a) =>
            (filter.role === 'all' || String(a.roleId) === filter.role) &&
            (filter.status === 'all' ? true
                : filter.status === 'current' ? a.status !== 'deleted'
                    : a.status === filter.status) &&
            `${a.name} ${a.email}`.toLowerCase().includes(q));

        const roleCell = (a) => h(
            'span',
            { class: 'staff-role' },
            a.role || 'Unassigned'
        );;

        const assignMunicipalityBtn = h(
            'button',
            {
                class: 'btn ghost',
                type: 'button',
                hidden: true,
                onclick: () => {
                    window.location.href = './assigned-farm-managers.html';
                },
            },
            'Assign Municipality'
        );

        const actionsCell = (a) => a.status === 'deleted'
            ? h('div', { class: 'actions' },
                h('button', { class: 'btn ghost', type: 'button', onclick: (e) => setStatus(a, 'active', e.currentTarget) }, 'Restore'),
                h('button', { class: 'btn danger', type: 'button', onclick: () => confirmPermanentDelete(a, () => purge(a)) }, 'Delete permanently'))
            : h('div', { class: 'actions' },
                h('button', { class: 'btn ghost', type: 'button', onclick: () => openEdit(a) }, 'Edit'),
                h('button', {
                    class: 'btn ghost', type: 'button',
                    onclick: (e) => setStatus(a, a.status === 'active' ? 'suspended' : 'active', e.currentTarget)
                }, a.status === 'active' ? 'Suspend' : 'Reactivate'),
                h('button', { class: 'btn danger', type: 'button', onclick: () => confirmDelete(a, () => setStatus(a, 'deleted')) }, 'Delete'));

        holder.replaceChildren(table([
            { label: 'Name', cell: person },
            { label: 'Email', cell: (a) => a.email },
            { label: 'Role', cell: roleCell },
            { label: 'Status', cell: statusBadge },
            { label: 'Actions', cell: actionsCell },
        ], rows, accounts.length ? 'No staff accounts match your search or filter.' : 'No staff accounts yet. Use "Add Account" to create one.'));

        count.textContent = `Showing ${rows.length} of ${accounts.length} account${accounts.length === 1 ? '' : 's'}`;
    };

    const replace = (row) => {
        accounts = accounts.map((a) => (a.id === row.id ? row : a));
    };

    const purge = async (account) => {
        try {
            await deleteStaffPermanently(account.id);

            accounts = accounts.filter((a) => a.id !== account.id);

            toast(`${account.name} was permanently deleted.`);
            draw();

            return true;
        } catch (err) {
            console.error('Permanent deletion failed:', err);
            toast(friendlyError(err));
            return false;
        }
    };

    const formOptions = (extra) => ({
        roles: lookups.roles,
        statuses: lookups.statuses,
        isDuplicate: (email, ignoreId) => accounts.some((a) => a.id !== ignoreId && a.email.toLowerCase() === email.toLowerCase()),
        ...extra,
    });

    const openAdd = () => openForm(formOptions({
        onSave: async (v) => {
            accounts.unshift(await createStaff(v));
            toast(`Added ${v.name}.`);
            draw();
        },
    }));

    const openEdit = (a) => openForm(formOptions({
        account: a,
        onSave: async (v) => {
            replace(await updateStaff(a.id, v));
            toast(`Updated ${v.name}.`);
            draw();
        },
    }));

    const setStatus = async (a, key, btn) => {
        const statusId = statusIdFor(key);
        if (!statusId) { toast(`The "${key}" status was not found in the database.`); return; }
        if (btn) btn.disabled = true;
        try {
            replace(await updateStaff(a.id, { statusId }));
            toast(`${a.name} is now ${key}.`);
        } catch (err) {
            console.error('Status change failed:', err);
            toast(friendlyError(err));
        }
        draw();
    };

    const addBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: openAdd }, 'Add Account');
    const assignMunicipalityBtn = h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => {
            window.location.href = './assigned-farm-managers.html';
        }
    }, 'Assign Municipality');

    assignMunicipalityBtn.hidden = true;

    const assignFarmLocationBtn = h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => {
            window.location.href = './assigned-warehouse-officers.html';
        }
    }, 'Assign Farm Location');

    assignFarmLocationBtn.hidden = true;

    const assignAccountantFarmBtn = h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => {
            window.location.href = './assigned-accountants.html';
        }
    }, 'Assign Farm Location');

    assignAccountantFarmBtn.hidden = true;



    const load = async () => {
        holder.replaceChildren(h('p', { class: 'muted' }, 'Loading staff accounts...'));
        count.textContent = '';
        try {
            [lookups, accounts] = await Promise.all([getLookups(), listStaff()]);
            toolbar.replaceChildren(
                search,
                select(
                    [['all', 'All roles'], ...lookups.roles.map(
                        (r) => [String(r.id), r.name]
                    )],
                    filter.role,
                    (v) => {
                        filter.role = v;

                        const selectedRole = lookups.roles.find(
                            (r) => String(r.id) === v
                        );

                        const roleName = selectedRole?.name?.toLowerCase().trim();

                        assignMunicipalityBtn.hidden = roleName !== 'farm manager';
                        assignFarmLocationBtn.hidden = roleName !== 'warehouse officer';
                        assignAccountantFarmBtn.hidden = roleName !== 'accountant';


                        draw();
                    },
                    'Filter by role'
                ),
                select(
                    [
                        ['current', 'All except deleted'],
                        ['active', 'Active'],
                        ['suspended', 'Suspended'],
                        ['inactive', 'Inactive'],
                        ['deleted', 'Deleted'],
                        ['all', 'Everything']
                    ],
                    filter.status,
                    (v) => {
                        filter.status = v;
                        draw();
                    },
                    'Filter by status'
                ),
                assignMunicipalityBtn,
                assignFarmLocationBtn,
                assignAccountantFarmBtn
            );
            addBtn.disabled = false;
            draw();
        } catch (err) {
            console.error('Failed to load staff accounts:', err);
            holder.replaceChildren(
                h('p', { class: 'msg error' }, `${friendlyError(err)} Could not load staff accounts.`),
                h('button', { class: 'btn ghost staff-retry', type: 'button', onclick: load }, 'Retry'));
        }
    };

    root.append(
        pageHead('Staff accounts', 'Create and manage staff accounts.', addBtn),
        h('section', { class: 'card' }, toolbar, holder, count));
    toolbar.append(search);
    await load();
}