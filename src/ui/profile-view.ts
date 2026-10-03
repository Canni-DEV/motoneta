import type { PlayerProfile } from '../core/game';
import { button as b, esc } from './widgets';

export function profilesDialog(profiles: PlayerProfile[], p: PlayerProfile, activeProfile: string) {
  return '<h2>Perfiles locales</h2><div class="profile-layout"><div class="profile-list">' +
    profiles
      .map((v) =>
        b(
          'profile-select',
          '<i class="color-dot" style="background:' +
            v.color +
            '"></i><span>' +
            esc(v.name) +
            '</span>',
          v.id,
          'aria-pressed="' + (v.id === p.id) + '"',
        ),
      )
      .join('') +
    '</div><div class="profile-row"><label>Nombre<input data-profile-name="' +
    esc(p.id) +
    '" maxlength="40" value="' +
    esc(p.name) +
    '"></label><label>Color<input type="color" data-profile-color="' +
    esc(p.id) +
    '" value="' +
    p.color +
    '"></label><div class="actions">' +
    b(
      'activate-profile',
      p.id === activeProfile ? 'Perfil activo' : 'Usar perfil',
      p.id,
      p.id === activeProfile ? 'disabled' : 'class="primary"',
    ) +
    b(
      'delete-profile',
      'Eliminar',
      p.id,
      profiles.length === 1 ? 'disabled' : 'class="danger"',
    ) +
    b('garage-open', 'Personalizar moto y piloto', p.id, 'class="primary"') +
    '</div></div></div><div class="actions">' +
    b('add-profile', 'Añadir perfil') +
    b('close-modal', 'Listo', '', 'class="primary"') +
    '</div><p class="muted">Los perfiles y sus marcas se guardan en este navegador.</p>';
}
