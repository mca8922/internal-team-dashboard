'use client';

// One department's reporting-template editor row, used inside GoalsView's
// "Report templates" modal. Extracted verbatim. No behaviour change.
import * as React from 'react';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { RichTextEditor } from '@/components/RichTextEditor';
import { useToast } from '@/components/Toast';
import { saveReportTemplate } from '@/lib/actions';

// One department's reporting-template editor inside the "Report templates"
// modal. Members of that department see this template prefilled when they open
// the work-report editor, so they report in a consistent shape.
export function ReportTemplateEditorRow({
  department,
  initialBody,
}: {
  department: string;
  initialBody: string;
}) {
  const toast = useToast();
  const [body, setBody] = React.useState(initialBody);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setBody(initialBody), [initialBody]);
  const dirty = body !== initialBody;

  const save = async () => {
    setSaving(true);
    try {
      await saveReportTemplate(department, body);
      toast(`Saved ${department} template`);
    } catch (e) {
      toast((e as Error).message || 'Could not save the template.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rt-tpl-row">
      <div className="rt-tpl-head">
        <Icon name="building" size={14} />
        <span className="rt-tpl-dept">{department}</span>
      </div>
      <RichTextEditor
        value={body}
        onChange={setBody}
        placeholder="e.g. 1) What I shipped today  2) Numbers / impact  3) Blockers"
        ariaLabel={`${department} reporting template`}
      />
      <div className="rt-tpl-actions">
        <Button size="sm" icon="check" onClick={save} disabled={!dirty} loading={saving}>
          Save template
        </Button>
      </div>
    </div>
  );
}
