import { h, table, badge, person, select, fmtDate, toast, pageHead, ROLE } from './ui.js';
import { listUsers, setUserStatus } from './api.js';
import { openDetails } from './details.js';

/**
 * Ask for a rejection reason using the same modal style as the delete dialog.
 * Resolves to the trimmed reason, or null if the admin cancels.
 */
function askRejectionReason(userName) {
    return new Promise((resolve) => {
        const previousFocus = document.activeElement;

        const overlay = document.createElement('div');
        overlay.className = 'delete-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'delete-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'rejectTitle');

        const icon = document.createElement('div');
        icon.className = 'delete-modal-icon';
        icon.textContent = '!';

        const title = document.createElement('h2');
        title.id = 'rejectTitle';
        title.textContent = 'Reject application';

        const text = document.createElement('p');
        text.className = 'delete-modal-message';
        const name = document.createElement('strong');
        name.textContent = userName;
        text.append(
            "Why is ", name, "'s application being rejected? ",
            'Explain what information or documents need correction.'
        );

        const field = document.createElement('textarea');
        field.className = 'reject-reason';
        field.rows = 4;
        field.maxLength = 500;
        field.placeholder = 'e.g. The uploaded ID is blurry. Please upload a clearer photo.';
        field.setAttribute('aria-label', 'Rejection reason');

        const actions = document.createElement('div');
        actions.className = 'delete-modal-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn delete-cancel';
        cancel.textContent = 'Cancel';

        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'btn delete-confirm';
        confirm.textContent = 'Reject';
        confirm.disabled = true;

        actions.append(cancel, confirm);
        modal.append(icon, title, text, field, actions);
        overlay.append(modal);

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            document.body.classList.remove('modal-open');
            previousFocus?.focus?.();
            resolve(result);
        };

        const submit = () => {
            const reason = field.value.trim();
            if (reason) close(reason);
        };

        const onKey = (event) => {
            if (event.key === 'Escape') close(null);
        };

        field.addEventListener('input', () => {
            confirm.disabled = !field.value.trim();
        });
        cancel.addEventListener('click', () => close(null));
        confirm.addEventListener('click', submit);
        overlay.addEventListener('mousedown', (event) => {
            if (event.target === overlay) close(null);
        });
        document.addEventListener('keydown', onKey);

        document.body.append(overlay);
        document.body.classList.add('modal-open');
        field.focus();
    });
}

export async function render(root, ctx) {
    const filter = { role: 'all', status: 'pending' };
    const holder = h('div');

    /** Apply an approval or a reasoned rejection, then refresh the queue. */
    const decide = async (user, status) => {
        let reason = '';

        if (status === 'rejected') {
            const entered = await askRejectionReason(user.name);

            // Cancelled (button, Escape, or backdrop click).
            if (entered === null) return;

            reason = entered;
        }

        try {
            const result = await setUserStatus(user, status, reason);

            if (status === 'active') {
                toast(`Approved ${user.name}`);
            } else {
                toast(
                    result?.emailSent
                        ? `Rejected ${user.name}. Email sent.`
                        : `Rejected ${user.name}, but the email was not sent.`
                );
            }

            await draw();
            ctx.refreshBadge();
        } catch (err) {
            console.error('Could not update application:', err);
            toast(err.message || 'Could not update this application.');
        }
    };

    /** Render applicants matching the current role, status, and search filters. */
    const draw = async () => {
        try {
            const q = ctx.query.toLowerCase();
            const rows = (await listUsers()).filter((u) =>
                u.status !== 'suspended' &&
                (filter.role === 'all' || u.role === filter.role) &&
                (filter.status === 'all' || u.status === filter.status) &&
                `${u.name} ${u.email}`.toLowerCase().includes(q));

            holder.replaceChildren(table([
                { label: 'Applicant', cell: person },
                { label: 'Email', cell: (u) => u.email },
                { label: 'Role', cell: (u) => ROLE[u.role].label.slice(0, -1) },
                { label: 'Submitted', cell: (u) => fmtDate(u.joined) },
                { label: 'Status', cell: (u) => badge(u.status) },
                {
                    label: 'Action',
                    cell: (u) => h('div', { class: 'actions' },
                        h('button', { class: 'btn ghost', type: 'button', onclick: () => openDetails(u, (s) => decide(u, s)) }, 'View details'),
                        u.status === 'pending' ? h('button', { class: 'btn', type: 'button', onclick: () => decide(u, 'active') }, 'Approve') : null,
                        u.status === 'pending' ? h('button', { class: 'btn danger', type: 'button', onclick: () => decide(u, 'rejected') }, 'Reject') : null),
                },
            ], rows, 'No applications match these filters.'));
        } catch (err) {
            console.error('Failed to load applications:', err);
            holder.replaceChildren(h('p', { class: 'msg error' }, 'Could not load applications. Check the browser console and Supabase permissions.'));
        }
    };

    const refresh = h('button', { class: 'btn ghost', type: 'button' }, 'Refresh');
    refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        await draw();
        refresh.disabled = false;
    });

    root.append(
        pageHead('Registration applications', 'Review pending farmers, buyers, and suppliers.'),
        h('section', { class: 'card' },
            h('div', { class: 'toolbar' },
                select([['all', 'All roles'], ['farmer', 'Farmers'], ['buyer', 'Buyers'], ['supplier', 'Suppliers']], filter.role,
                    (v) => { filter.role = v; draw(); }, 'Applicant role'),
                select([['pending', 'Pending'], ['active', 'Approved'], ['rejected', 'Rejected'], ['all', 'All statuses']], filter.status,
                    (v) => { filter.status = v; draw(); }, 'Application status'),
                refresh),
            holder));
    await draw();
}