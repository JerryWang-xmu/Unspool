export interface NotificationCenterProps {
  readonly notifications: readonly {
    id: string;
    type: string;
    title: string;
    body?: string;
    readAt?: string;
  }[];
  readonly onMarkRead: (id: string) => Promise<void>;
}

export function NotificationCenter({ notifications, onMarkRead }: NotificationCenterProps) {
  return (
    <section
      className="panel"
      data-testid="notification-center"
      aria-labelledby="notification-center-title"
    >
      <h2 id="notification-center-title">Notifications</h2>
      {notifications.length === 0 ? (
        <p>No notifications.</p>
      ) : (
        <ul>
          {notifications.map((notification) => (
            <li
              key={notification.id}
              data-testid="notification-item"
              data-state={notification.readAt ? "read" : "unread"}
            >
              <strong>{notification.type}</strong>: {notification.title}
              {notification.body ? <p>{notification.body}</p> : null}
              {notification.readAt ? null : (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    void onMarkRead(notification.id);
                  }}
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
