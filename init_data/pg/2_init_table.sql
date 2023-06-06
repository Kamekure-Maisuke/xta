\c sample;

CREATE TABLE todos (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  level INT NOT NULL
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
