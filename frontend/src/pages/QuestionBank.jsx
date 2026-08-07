import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, Modal } from '../components/ui';

const TYPE_LABEL = { multiple_choice: 'Multiple choice', true_false: 'True/False', short_answer: 'Short answer' };
const emptyQ = { bank_id: '', type: 'multiple_choice', content: '', answer: '', choices: '', difficulty: 1, subject_id: '', duration: 10, points: 10, keywords: '' };

export default function QuestionBank() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [banks, questions, subjects] = await Promise.all([api('/questions/banks'), api('/questions'), api('/subjects')]);
    return { banks, questions, subjects };
  }, []);

  const [bankForm, setBankForm] = useState({ name: '', description: '', subject_id: '' });
  const [showBank, setShowBank] = useState(false);
  const [bankEditing, setBankEditing] = useState(null);
  const [bankId, setBankId] = useState('');
  const [showQ, setShowQ] = useState(false);
  const [qEditing, setQEditing] = useState(null);
  const [q, setQ] = useState(emptyQ);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const visible = bankId ? data.questions.filter((x) => x.bank_id === Number(bankId)) : data.questions;

  function openNewBank() { setBankForm({ name: '', description: '', subject_id: '' }); setBankEditing(null); setShowBank(true); }
  function openEditBank(b) {
    setBankForm({ name: b.name, description: b.description || '', subject_id: b.subject_id ? String(b.subject_id) : '' });
    setBankEditing(b.id);
    setShowBank(true);
  }

  async function saveBank(e) {
    e.preventDefault();
    const body = { ...bankForm, subject_id: bankForm.subject_id ? Number(bankForm.subject_id) : null };
    try {
      if (bankEditing) await api(`/questions/banks/${bankEditing}`, { method: 'PUT', body });
      else {
        const res = await api('/questions/banks', { method: 'POST', body });
        setBankId(String(res.id));
      }
      setShowBank(false);
      setBankForm({ name: '', description: '', subject_id: '' });
      setBankEditing(null);
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function removeBank(id) {
    if (!window.confirm('Delete this question bank? All questions inside it will also be deleted.')) return;
    try {
      await api(`/questions/banks/${id}`, { method: 'DELETE' });
      if (bankId === String(id)) setBankId('');
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  function openNewQuestion() {
    setQ({ ...emptyQ, bank_id: bankId || (data.banks[0] ? String(data.banks[0].id) : '') });
    setQEditing(null);
    setShowQ(true);
  }

  function openEditQuestion(x) {
    setQ({
      bank_id: x.bank_id ? String(x.bank_id) : bankId,
      type: x.type,
      content: x.content,
      answer: x.answer || '',
      choices: (x.choices || []).join('\n'),
      difficulty: x.difficulty,
      subject_id: x.subject_id ? String(x.subject_id) : '',
      duration: x.duration,
      points: x.points,
      keywords: (x.keywords || []).join(', ')
    });
    setQEditing(x.id);
    setShowQ(true);
  }

  async function saveQuestion(e) {
    e.preventDefault();
    const body = {
      bank_id: Number(q.bank_id), type: q.type, content: q.content, answer: q.answer,
      choices: q.type === 'multiple_choice' ? q.choices.split('\n').map((c) => c.trim()).filter(Boolean) : null,
      difficulty: Number(q.difficulty), subject_id: q.subject_id ? Number(q.subject_id) : null,
      duration: Number(q.duration), points: Number(q.points),
      keywords: q.keywords.split(',').map((k) => k.trim()).filter(Boolean)
    };
    try {
      if (qEditing) await api(`/questions/${qEditing}`, { method: 'PUT', body });
      else await api('/questions', { method: 'POST', body });
      setShowQ(false);
      setQ(emptyQ);
      setQEditing(null);
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function removeQuestion(id) {
    if (!window.confirm('Delete this question?')) return;
    try {
      await api(`/questions/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1>Question Bank</h1>
      <div className="grid cols-2">
        <div className="card">
          <div className="spread mb">
            <h3 style={{ margin: 0 }}>Banks</h3>
            <button className="btn small primary" onClick={openNewBank}>+ Bank</button>
          </div>
          <div className="pill-row mb">
            <button className={`btn small ${bankId === '' ? 'primary' : ''}`} onClick={() => setBankId('')}>All</button>
            {data.banks.map((b) => (
              <button key={b.id} className={`btn small ${bankId === String(b.id) ? 'primary' : ''}`} onClick={() => setBankId(String(b.id))}>
                {b.name} <span className="muted">({b.question_count})</span>
              </button>
            ))}
          </div>

          <div className="spread mb">
            <h3 style={{ margin: 0 }}>Questions</h3>
            <button className="btn small primary" onClick={openNewQuestion}>+ Question</button>
          </div>
          <table className="tbl">
            <thead><tr><th>Type</th><th>Content</th><th>Difficulty</th><th>Pts</th><th></th></tr></thead>
            <tbody>
              {visible.map((x) => (
                <tr key={x.id}>
                  <td><Badge tone="blue">{TYPE_LABEL[x.type]}</Badge></td>
                  <td>{x.content}</td>
                  <td>{'★'.repeat(x.difficulty) || '1'}</td>
                  <td>{x.points}</td>
                  <td className="flex">
                    <button className="btn small" onClick={() => openEditQuestion(x)}>Edit</button>
                    <button className="btn small danger" onClick={() => removeQuestion(x.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <Empty text="No questions in this bank yet." />}

          <div className="spread mt">
            <h3 style={{ margin: 0, fontSize: 15 }}>Banks management</h3>
          </div>
          <table className="tbl">
            <thead><tr><th>Name</th><th>Questions</th><th></th></tr></thead>
            <tbody>
              {data.banks.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.question_count}</td>
                  <td className="flex">
                    <button className="btn small" onClick={() => openEditBank(b)}>Edit</button>
                    <button className="btn small danger" onClick={() => removeBank(b.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 className="mb">About the question format</h3>
          <ul className="muted" style={{ lineHeight: 1.9 }}>
            <li><strong>Multiple choice</strong> - one choice per line in the editor, plus the correct letter (A/B/C/D).</li>
            <li><strong>True/False</strong> - answer is <code>true</code> or <code>false</code>.</li>
            <li><strong>Short answer</strong> - free text expected answer.</li>
            <li><strong>Difficulty</strong> - 1 (easy) to 5 (hard); higher difficulty is worth more under the scoring model.</li>
            <li><strong>Duration</strong> - seconds students have to answer.</li>
            <li><strong>Keywords</strong> - comma separated phrases the audio pipeline uses to match the spoken question to this question (voice recognition).</li>
          </ul>
        </div>
      </div>

      {showBank && (
        <Modal title={bankEditing ? 'Edit question bank' : 'New question bank'} onClose={() => setShowBank(false)}>
          <form onSubmit={saveBank}>
            <div className="field mb"><label>Name</label><input value={bankForm.name} onChange={(e) => setBankForm({ ...bankForm, name: e.target.value })} required /></div>
            <div className="form-row">
              <div className="field"><label>Description</label><input value={bankForm.description} onChange={(e) => setBankForm({ ...bankForm, description: e.target.value })} /></div>
              <div className="field"><label>Subject</label>
                <select value={bankForm.subject_id} onChange={(e) => setBankForm({ ...bankForm, subject_id: e.target.value })}>
                  <option value="">-</option>
                  {data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <button className="btn primary" type="submit">{bankEditing ? 'Save' : 'Create'}</button>
          </form>
        </Modal>
      )}

      {showQ && (
        <Modal title={qEditing ? 'Edit question' : 'New question'} onClose={() => setShowQ(false)}>
          <form onSubmit={saveQuestion}>
            <div className="form-row">
              <div className="field"><label>Bank</label>
                <select value={q.bank_id} onChange={(e) => setQ({ ...q, bank_id: e.target.value })} required>
                  {data.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Type</label>
                <select value={q.type} onChange={(e) => setQ({ ...q, type: e.target.value })}>
                  <option value="multiple_choice">Multiple choice</option>
                  <option value="true_false">True/False</option>
                  <option value="short_answer">Short answer</option>
                </select>
              </div>
            </div>
            <div className="field mb"><label>Content</label><textarea rows="2" value={q.content} onChange={(e) => setQ({ ...q, content: e.target.value })} required /></div>
            {q.type === 'multiple_choice' && (
              <div className="field mb"><label>Choices (one per line)</label><textarea rows="3" value={q.choices} onChange={(e) => setQ({ ...q, choices: e.target.value })} /></div>
            )}
            <div className="form-row">
              <div className="field"><label>Answer</label><input value={q.answer} onChange={(e) => setQ({ ...q, answer: e.target.value })} /></div>
              <div className="field"><label>Subject</label>
                <select value={q.subject_id} onChange={(e) => setQ({ ...q, subject_id: e.target.value })}>
                  <option value="">-</option>
                  {data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="field"><label>Difficulty (1-5)</label><input type="number" min="1" max="5" value={q.difficulty} onChange={(e) => setQ({ ...q, difficulty: e.target.value })} /></div>
              <div className="field"><label>Duration (s)</label><input type="number" value={q.duration} onChange={(e) => setQ({ ...q, duration: e.target.value })} /></div>
              <div className="field"><label>Points</label><input type="number" value={q.points} onChange={(e) => setQ({ ...q, points: e.target.value })} /></div>
            </div>
            <div className="field mb"><label>Voice keywords (comma separated)</label><input value={q.keywords} onChange={(e) => setQ({ ...q, keywords: e.target.value })} /></div>
            <button className="btn primary" type="submit">{qEditing ? 'Save question' : 'Create question'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
