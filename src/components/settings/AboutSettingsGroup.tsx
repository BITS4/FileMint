import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';

import { ListRow } from '@/components/ui';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '@/constants/legal';
import { SettingsGroup } from './SettingsShared';

export function AboutSettingsGroup() {
  return (
    <SettingsGroup title="About">
      <ListRow
        icon="shield-check-outline"
        title="Privacy policy"
        onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)}
        showChevron
      />
      <ListRow
        icon="file-document-outline"
        title="Terms of use"
        onPress={() => void WebBrowser.openBrowserAsync(TERMS_OF_USE_URL)}
        showChevron
      />
      <ListRow icon="information-outline" title="Version" value={Constants.expoConfig?.version ?? '1.2.0'} />
    </SettingsGroup>
  );
}
