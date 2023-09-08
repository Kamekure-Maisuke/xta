\c sample;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  level INT NOT NULL
);

CREATE TABLE todos (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  user_id INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE todo_history (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  todo_id INT REFERENCES todos(id),
  action_type CHAR(1) NOT NULL DEFAULT '0',
  action_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


INSERT INTO todos
  (title)
VALUES
  ('タスク1'),
  ('タスク2'),
  ('タスク3'),
  ('タスク4'),
  ('タスク5'),
  ('タスク6'),
  ('タスク7'),
  ('タスク8'),
  ('タスク9'),
  ('タスク10'),
  ('タスク11'),
  ('タスク12'),
  ('タスク13'),
  ('タスク14'),
  ('タスク15');
