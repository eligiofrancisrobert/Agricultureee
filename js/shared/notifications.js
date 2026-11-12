
/* ============================================================
   TANIKALA - SHARED NOTIFICATION CENTER
   Farm Manager and Warehouse Officer only.
   Realtime INSERT / UPDATE / DELETE + fallback sync.
   ============================================================ */

let activeSupabase = null;
let activeChannel = null;
let activeWrapper = null;
let activeUserId = null;

const MAX_NOTIFICATIONS = 30;
const FALLBACK_SYNC_INTERVAL = 15000;

const createElement = (tag, className, text = '') => {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text) element.textContent = text;

    return element;
};

const formatNotificationDate = (value) => {
    if (!value) return '';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
};

export async function initNotifications(supabase) {
    cleanupNotifications();

    const topbar = document.querySelector('.topbar-right');

    if (!topbar) {
        console.error('Notifications: .topbar-right element was not found.');
        return;
    }

    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError || !user) {
        console.error(
            'Notifications: unable to get authenticated user.',
            authError
        );
        return;
    }

    const currentUserId = user.id;
    const currentSupabase = supabase;

    activeSupabase = currentSupabase;
    activeUserId = currentUserId;

    console.log(
        'Notifications: initializing for user:',
        currentUserId
    );

    const wrapper = createElement('div', 'notification-center');

    const bell = createElement('button', 'notification-bell');
    bell.type = 'button';
    bell.setAttribute('aria-label', 'Notifications');
    bell.setAttribute('aria-expanded', 'false');
    bell.title = 'Notifications';

    bell.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path>
            <path d="M10 21h4"></path>
        </svg>
    `;

    const unreadBadge = createElement('span', 'notification-count');
    unreadBadge.hidden = true;

    const panel = createElement('section', 'notification-panel');
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Notifications');

    const panelHeader = createElement('div', 'notification-panel-header');

    const heading = createElement(
        'h3',
        'notification-panel-title',
        'Notifications'
    );

    const markAllButton = createElement(
        'button',
        'notification-mark-all',
        'Mark all as read'
    );

    markAllButton.type = 'button';

    panelHeader.append(heading, markAllButton);

    const notificationList = createElement('div', 'notification-list');

    panel.append(panelHeader, notificationList);
    wrapper.append(bell, unreadBadge, panel);

    const avatar = topbar.querySelector('#fmAvatar, #woAvatar');

    if (avatar) {
        topbar.insertBefore(wrapper, avatar);
    } else {
        topbar.append(wrapper);
    }

    activeWrapper = wrapper;

    let notifications = [];
    let loading = false;
    let reloadPending = false;
    let isDestroyed = false;
    let fallbackTimer = null;

    function updateUnreadCount() {
        const unread = notifications.filter(
            notification => !notification.is_read
        ).length;

        unreadBadge.textContent = unread > 99 ? '99+' : String(unread);
        unreadBadge.hidden = unread === 0;
        markAllButton.disabled = unread === 0;
    }

    function renderNotifications() {
        notificationList.replaceChildren();

        if (!notifications.length) {
            notificationList.append(
                createElement(
                    'p',
                    'notification-empty',
                    'No notifications yet.'
                )
            );

            updateUnreadCount();
            return;
        }

        for (const notification of notifications) {
            const item = createElement(
                'button',
                `notification-item${notification.is_read ? ' is-read' : ' is-unread'}`
            );

            item.type = 'button';

            const itemContent = createElement(
                'span',
                'notification-item-content'
            );

            const title = createElement(
                'strong',
                'notification-item-title',
                notification.title || 'Notification'
            );

            const message = createElement(
                'span',
                'notification-item-message',
                notification.message || ''
            );

            const date = createElement(
                'span',
                'notification-item-date',
                formatNotificationDate(notification.created_at)
            );

            itemContent.append(title, message, date);
            item.append(itemContent);

            if (!notification.is_read) {
                item.append(
                    createElement('span', 'notification-unread-dot')
                );
            }

            item.addEventListener('click', async () => {
                if (!notification.is_read) {
                    await markAsRead(notification.notification_id);
                }
            });

            notificationList.append(item);
        }

        updateUnreadCount();
    }

    function upsertNotification(incoming) {
        if (
            !incoming ||
            incoming.recipient_user_id !== currentUserId ||
            !incoming.notification_id
        ) {
            return;
        }

        const index = notifications.findIndex(
            item => item.notification_id === incoming.notification_id
        );

        if (index !== -1) {
            notifications[index] = {
                ...notifications[index],
                ...incoming
            };
        } else {
            notifications.unshift(incoming);
        }

        notifications.sort(
            (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
        );

        notifications = notifications.slice(0, MAX_NOTIFICATIONS);

        renderNotifications();
    }

    async function loadNotifications() {
        if (isDestroyed) return;

        if (loading) {
            reloadPending = true;
            return;
        }

        loading = true;

        try {
            do {
                reloadPending = false;

                const { data, error } = await currentSupabase
                    .from('notifications')
                    .select(`
                        notification_id,
                        recipient_user_id,
                        notification_type,
                        title,
                        message,
                        related_table,
                        related_id,
                        metadata,
                        is_read,
                        read_at,
                        created_at
                    `)
                    .eq('recipient_user_id', currentUserId)
                    .order('created_at', { ascending: false })
                    .limit(MAX_NOTIFICATIONS);

                if (error) throw error;
                if (isDestroyed) return;

                notifications = data || [];

                renderNotifications();

                console.log(
                    'Notifications: loaded successfully.',
                    notifications.length
                );

            } while (reloadPending && !isDestroyed);

        } catch (error) {
            console.error(
                'Notifications: failed to load notifications.',
                error
            );

            if (!isDestroyed) {
                notificationList.replaceChildren(
                    createElement(
                        'p',
                        'notification-error',
                        'Unable to load notifications. Please try again.'
                    )
                );
            }

        } finally {
            loading = false;

            if (reloadPending && !isDestroyed) {
                reloadPending = false;
                loadNotifications();
            }
        }
    }

    async function markAsRead(notificationId) {
        if (isDestroyed) return;

        const { error } = await currentSupabase
            .from('notifications')
            .update({
                is_read: true,
                read_at: new Date().toISOString()
            })
            .eq('notification_id', notificationId)
            .eq('recipient_user_id', currentUserId)
            .eq('is_read', false);

        if (error) {
            console.error(
                'Notifications: failed to mark notification as read.',
                error
            );
            return;
        }

        const notification = notifications.find(
            item => item.notification_id === notificationId
        );

        if (notification) {
            notification.is_read = true;
            notification.read_at = new Date().toISOString();
        }

        renderNotifications();
    }

    async function markAllAsRead() {
        if (isDestroyed) return;

        markAllButton.disabled = true;

        const { error } = await currentSupabase
            .from('notifications')
            .update({
                is_read: true,
                read_at: new Date().toISOString()
            })
            .eq('recipient_user_id', currentUserId)
            .eq('is_read', false);

        if (error) {
            console.error(
                'Notifications: failed to mark all as read.',
                error
            );

            updateUnreadCount();
            return;
        }

        notifications = notifications.map(notification => ({
            ...notification,
            is_read: true,
            read_at: notification.read_at || new Date().toISOString()
        }));

        renderNotifications();
    }

    function closePanel() {
        panel.hidden = true;
        bell.setAttribute('aria-expanded', 'false');
    }

    bell.addEventListener('click', async () => {
        const willOpen = panel.hidden;

        panel.hidden = !willOpen;
        bell.setAttribute('aria-expanded', String(willOpen));

        if (willOpen) {
            await loadNotifications();
        }
    });

    markAllButton.addEventListener('click', markAllAsRead);

    const outsideClickHandler = event => {
        if (!wrapper.contains(event.target)) {
            closePanel();
        }
    };

    const visibilityHandler = () => {
        if (
            document.visibilityState === 'visible' &&
            !isDestroyed
        ) {
            loadNotifications();
        }
    };

    document.addEventListener('click', outsideClickHandler);
    document.addEventListener('visibilitychange', visibilityHandler);

    wrapper.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closePanel();
            bell.focus();
        }
    });

    wrapper._notificationOutsideClickHandler = outsideClickHandler;
    wrapper._notificationVisibilityHandler = visibilityHandler;

    wrapper._notificationDestroy = () => {
        isDestroyed = true;

        if (fallbackTimer) {
            clearInterval(fallbackTimer);
            fallbackTimer = null;
        }
    };

    // Load existing notifications first.
    await loadNotifications();

    if (isDestroyed) return;

    console.log('Notifications: connecting to Supabase Realtime...');

    // Listen to all notification changes.
    // Recipient filtering is performed locally.
    const channel = currentSupabase
        .channel(`notifications-${currentUserId}-${Date.now()}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'notifications'
            },
            payload => {
                if (isDestroyed) return;

                const eventType = payload.eventType;
                const changedRecord = payload.new || payload.old;

                if (
                    changedRecord?.recipient_user_id !== currentUserId
                ) {
                    return;
                }

                console.log(
                    'Notifications: Realtime event received.',
                    eventType,
                    changedRecord
                );

                if (eventType === 'INSERT' || eventType === 'UPDATE') {
                    upsertNotification(payload.new);
                }

                if (eventType === 'DELETE') {
                    notifications = notifications.filter(
                        item =>
                            item.notification_id !==
                            payload.old.notification_id
                    );

                    renderNotifications();
                }

                // Reconcile local state with the database.
                loadNotifications();
            }
        )
        .subscribe((status, error) => {
            console.log('Notifications Realtime status:', status);

            if (status === 'SUBSCRIBED') {
                console.log('Notifications Realtime connected.');
                loadNotifications();
            }

            if (
                status === 'CHANNEL_ERROR' ||
                status === 'TIMED_OUT'
            ) {
                console.error(
                    'Notifications: Realtime connection failed.',
                    error
                );
            }

            if (status === 'CLOSED') {
                console.warn(
                    'Notifications: Realtime channel closed.'
                );
            }
        });

    activeChannel = channel;

    // Fallback synchronization in case a Realtime event is missed.
    fallbackTimer = setInterval(() => {
        if (
            !isDestroyed &&
            document.visibilityState === 'visible'
        ) {
            loadNotifications();
        }
    }, FALLBACK_SYNC_INTERVAL);
}

export function cleanupNotifications() {
    if (activeWrapper) {
        if (activeWrapper._notificationDestroy) {
            activeWrapper._notificationDestroy();
        }

        const outsideClickHandler =
            activeWrapper._notificationOutsideClickHandler;

        if (outsideClickHandler) {
            document.removeEventListener(
                'click',
                outsideClickHandler
            );
        }

        const visibilityHandler =
            activeWrapper._notificationVisibilityHandler;

        if (visibilityHandler) {
            document.removeEventListener(
                'visibilitychange',
                visibilityHandler
            );
        }

        activeWrapper.remove();
    }

    if (activeChannel && activeSupabase) {
        activeSupabase.removeChannel(activeChannel);
    }

    activeChannel = null;
    activeWrapper = null;
    activeSupabase = null;
    activeUserId = null;
}
