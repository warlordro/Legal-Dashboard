-- 0036_openrouter_stack_western.up.sql - v2.38.0: stack-ul chinezesc OpenRouter
-- eliminat din aplicatie. Coloana openrouter_stack ramane in schema (evitam
-- rebuild + CHECK-ul din 0023 ramane neatins); valorile legacy 'chinese' se
-- coercseaza la 'western'.
UPDATE owner_ai_settings SET openrouter_stack = 'western' WHERE openrouter_stack = 'chinese';
