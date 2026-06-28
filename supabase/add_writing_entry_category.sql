-- Migration: add category column to user_writing_entries
-- Run this against your Supabase database to add the category field.
-- Category values: 'reflective' | 'persuasive' | 'creative' | 'sandbox'
-- (replaces the old diary / essay / free inference from prompt text)

alter table public.user_writing_entries
  add column if not exists category text;
