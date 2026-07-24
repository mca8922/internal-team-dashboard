'use client';

// Department picker — a dropdown of the org's existing departments plus a
// "Create new department…" option that reveals a free-text input. Shared by
// the Create-account and Manage-member modals.
import * as React from 'react';

const NEW = '__new__';

export function DepartmentSelect({
  value,
  departments,
  onChange,
  autoFocus,
}: {
  value: string;
  departments: string[];
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  // "creating" mode shows the text input; it's on when the current value
  // isn't one of the known departments (e.g. a freshly typed new name).
  const isKnown = departments.includes(value);
  const [creating, setCreating] = React.useState(value !== '' && !isKnown);

  // Keep in sync if the value is reset externally (e.g. modal reopened).
  React.useEffect(() => {
    setCreating(value !== '' && !departments.includes(value));
  }, [value, departments]);

  if (creating) {
    return (
      <div className="flex items-center gap-2">
        <input
          className="input"
          value={value}
          autoFocus={autoFocus}
          placeholder="New department name"
          onChange={(e) => onChange(e.target.value)}
        />
        {departments.length > 0 ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setCreating(false);
              onChange('');
            }}
          >
            Pick existing
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <select
      className="select"
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW) {
          setCreating(true);
          onChange('');
        } else {
          onChange(e.target.value);
        }
      }}
    >
      <option value="" disabled>
        Select a department…
      </option>
      {departments.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
      <option value={NEW}>+ Create new department…</option>
    </select>
  );
}
