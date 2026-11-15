import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DueChip } from './due-chip';

describe('due chip', () => {
  it('says the date in the short style, in the label and in the tooltip', () => {
    render(<DueChip date="2020-03-18" />);
    expect(screen.getByText('18 Mar')).toBeVisible();
    expect(screen.getByTitle('Due 18 Mar')).toBeVisible();
  });
});
