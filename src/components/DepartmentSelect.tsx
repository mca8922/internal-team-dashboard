'use client';

// Department picker — a dropdown of the org's existing departments plus a
// "Create new department…" option that reveals a free-text input. Shared by
// the Create-account and Manage-member modals.
//
// `allowCreate={false}` drops the create option and offers only the departments
// that already exist — used by the task form, where a department is picked, not
// invented.
import * as React from 'react';

const NEW = '__new__';

export function DepartmentSelect({
  value,
  departments,
  onChange,
  autoFocus,
  allowCreate = true,
}: {
  value: string;
  departments: string[];
  onChange: (v: string) => void;
  autoFocus?: boolean;
  allowCreate?: boolean;
}) {
  // "creating" mode shows the text input; it's on when the current value
  // isn't one of the known departments (e.g. a freshly typed new name).
  const isKnown = departments.includes(value);
  const [creating, setCreating] = React.useState(allowCreate && value !== '' && !isKnown);

  // Keep in sync if the value is reset externally (e.g. modal reopened).
  React.useEffect(() => {
    setCreating(allowCreate && value !== '' && !departments.includes(value));
  }, [value, departments, allowCreate]);

  // Without the create option, a value the org no longer lists still has to be
  // selectable — otherwise editing an old record would silently blank its
  // department. Show it alongside the current list rather than dropping it.
  const options = !allowCreate && value !== '' && !isKnown ? [...departments, value] : departments;

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
      {options.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
      {allowCreate ? <option value={NEW}>+ Create new department…</option> : null}
    </select>
  );
}
