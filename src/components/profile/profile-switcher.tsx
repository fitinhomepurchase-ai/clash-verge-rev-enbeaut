import {
  CheckRounded,
  ExpandMoreRounded,
  FolderOpenRounded,
} from '@mui/icons-material'
import {
  Button,
  CircularProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProfiles } from '@/hooks/use-profiles'
import { showNotice } from '@/services/notice-service'

interface ProfileSwitcherProps {
  onSwitched?: () => void
}

const isSwitchableProfile = (profile: IProfileItem) =>
  profile.type === 'remote' || profile.type === 'local'

export const ProfileSwitcher = ({ onSwitched }: ProfileSwitcherProps) => {
  const { t } = useTranslation()
  const { profiles, current, patchProfiles, mutateProfiles } = useProfiles()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [switchingUid, setSwitchingUid] = useState<string | null>(null)

  const items = (profiles?.items ?? []).filter(isSwitchableProfile)
  const disabled = items.length === 0 || switchingUid !== null

  const handleSwitch = useLockFn(async (uid: string) => {
    if (uid === profiles?.current) {
      setAnchorEl(null)
      return
    }

    setSwitchingUid(uid)
    try {
      const outcome = await patchProfiles({ current: uid })
      if (outcome.status === 'busy') {
        showNotice.info('profiles.page.feedback.notifications.switchBusy', 2000)
        return
      }
      if (outcome.status === 'valid') {
        await mutateProfiles()
        onSwitched?.()
        showNotice.success(
          'profiles.page.feedback.notifications.profileSwitched',
          1000,
        )
      }
    } catch (error) {
      showNotice.error(error)
    } finally {
      setSwitchingUid(null)
      setAnchorEl(null)
    }
  })

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={
          switchingUid ? <CircularProgress size={14} /> : <FolderOpenRounded />
        }
        endIcon={<ExpandMoreRounded />}
        disabled={disabled}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{ maxWidth: 220, textTransform: 'none' }}
      >
        {current?.name || t('layout.components.navigation.tabs.profiles')}
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        slotProps={{ paper: { sx: { minWidth: 240 } } }}
      >
        {items.map((item) => {
          const selected = item.uid === profiles?.current
          const isSwitching = item.uid === switchingUid
          return (
            <MenuItem
              key={item.uid}
              selected={selected}
              disabled={switchingUid !== null}
              onClick={() => void handleSwitch(item.uid)}
            >
              <ListItemIcon>
                {isSwitching ? (
                  <CircularProgress size={16} />
                ) : selected ? (
                  <CheckRounded fontSize="small" />
                ) : (
                  <FolderOpenRounded fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText
                primary={item.name || t('shared.labels.name')}
                secondary={item.type === 'remote' ? item.url : undefined}
                slotProps={{
                  primary: { noWrap: true },
                  secondary: { noWrap: true },
                }}
              />
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}
