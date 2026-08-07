'use strict';

const { row } = require('../db/database');

function ok(res, data) {
  return res.json(data);
}

function created(res, data) {
  return res.status(201).json(data);
}

function bad(res, msg) {
  return res.status(400).json({ error: msg });
}

function notFound(res, msg = 'Not found') {
  return res.status(404).json({ error: msg });
}

function forbidden(res, msg = 'Forbidden') {
  return res.status(403).json({ error: msg });
}

function wrap(fn) {
  return (req, res, next) => {
    try {
      const result = fn(req, res);
      if (result && typeof result.then === 'function') return result.catch(next);
      return result;
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Class-level access control (spec section VIII: access control by class & subject).
 * Admin always allowed. Homeroom teacher allowed on own class. Subject teacher
 * allowed when subject is in class scope or teaches the lesson. Parent/student
 * limited to own class/student. Guest denied.
 */
function canAccessClass(user, classId) {
  if (!user) return false;
  if (user.role_code === 'ADMIN') return true;
  if (user.role_code === 'GUEST') return false;

  const cls = row('SELECT * FROM classes WHERE id = ?', [classId]);
  if (!cls) return false;

  if (user.role_code === 'HOMEROOM_TEACHER') {
    return cls.homeroom_teacher_id === user.id || user.class_id === cls.id;
  }
  if (user.role_code === 'SUBJECT_TEACHER') {
    const teaches = row('SELECT 1 AS ok FROM lessons WHERE teacher_id = ? AND class_id = ? LIMIT 1', [user.id, classId]);
    if (teaches) return true;
    const students = row('SELECT 1 AS ok FROM students WHERE class_id = ? LIMIT 1', [classId]);
    return !!students;
  }
  if (user.role_code === 'PARENT') {
    const student = row('SELECT class_id FROM students WHERE parent_user_id = ?', [user.id]);
    return student && student.class_id === cls.id;
  }
  if (user.role_code === 'STUDENT') {
    const student = row('SELECT class_id FROM students WHERE user_id = ?', [user.id]);
    return student && student.class_id === cls.id;
  }
  return false;
}

function canAccessStudent(user, studentId) {
  if (!user) return false;
  if (user.role_code === 'ADMIN') return true;
  if (user.role_code === 'GUEST') return false;
  if (user.role_code === 'PARENT') {
    return !!row('SELECT 1 AS ok FROM students WHERE id = ? AND parent_user_id = ?', [studentId, user.id]);
  }
  if (user.role_code === 'STUDENT') {
    return !!row('SELECT 1 AS ok FROM students WHERE id = ? AND user_id = ?', [studentId, user.id]);
  }
  if (user.role_code === 'HOMEROOM_TEACHER') {
    return !!row('SELECT 1 AS ok FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ? AND c.homeroom_teacher_id = ?', [studentId, user.id]);
  }
  // subject teachers can view students
  return !!row('SELECT 1 AS ok FROM students WHERE id = ?', [studentId]);
}

module.exports = { ok, created, bad, notFound, forbidden, wrap, canAccessClass, canAccessStudent };
