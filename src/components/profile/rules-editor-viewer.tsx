import { arrayMove } from '@dnd-kit/helpers'
import {
  VerticalAlignBottomRounded,
  VerticalAlignTopRounded,
} from '@mui/icons-material'
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  TextField,
  styled,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import * as yaml from 'js-yaml'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseSearchBox, MonacoEditor, Switch } from '@/components/base'
import { RuleItem } from '@/components/profile/rule-item'
import { readProfileFile, saveProfileFile } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { useThemeMode } from '@/services/states'
import type { TranslationKey } from '@/types/generated/i18n-keys'
import type { MonacoEditorInstance } from '@/types/monaco'
import { MONACO_FONT_FAMILY } from '@/utils/font-family'
import getSystem from '@/utils/get-system'
import { isValidIpCidr } from '@/utils/network'
import { parseYamlSafe } from '@/utils/yaml'

import {
  buildGroupedItems,
  type GroupedVirtualItem,
  GroupedVirtualList,
} from './grouped-virtual-list'

interface Props {
  groupsUid: string
  mergeUid: string
  profileUid: string
  property: string
  open: boolean
  onClose: () => void
  onSave?: (prev?: string, curr?: string) => void
}

const portValidator = (value: string): boolean => {
  return new RegExp(
    '^(?:[1-9]\\d{0,3}|[1-5]\\d{4}|6[0-4]\\d{3}|65[0-4]\\d{2}|655[0-2]\\d|6553[0-5])$',
  ).test(value)
}

const rules: {
  name: string
  required?: boolean
  example?: string
  noResolve?: boolean
  validator?: (value: string) => boolean
}[] = [
  {
    name: 'DOMAIN',
    example: 'example.com',
  },
  {
    name: 'DOMAIN-SUFFIX',
    example: 'example.com',
  },
  {
    name: 'DOMAIN-KEYWORD',
    example: 'example',
  },
  {
    name: 'DOMAIN-REGEX',
    example: 'example.*',
  },
  {
    name: 'GEOSITE',
    example: 'youtube',
  },
  {
    name: 'GEOIP',
    example: 'CN',
    noResolve: true,
  },
  {
    name: 'SRC-GEOIP',
    example: 'CN',
  },
  {
    name: 'IP-ASN',
    example: '13335',
    noResolve: true,
    validator: (value) => (+value ? true : false),
  },
  {
    name: 'SRC-IP-ASN',
    example: '9808',
    validator: (value) => (+value ? true : false),
  },
  {
    name: 'IP-CIDR',
    example: '127.0.0.0/8',
    noResolve: true,
    validator: isValidIpCidr,
  },
  {
    name: 'IP-CIDR6',
    example: '2620:0:2d0:200::7/32',
    noResolve: true,
    validator: isValidIpCidr,
  },
  {
    name: 'SRC-IP-CIDR',
    example: '192.168.1.201/32',
    validator: isValidIpCidr,
  },
  {
    name: 'IP-SUFFIX',
    example: '8.8.8.8/24',
    noResolve: true,
    validator: isValidIpCidr,
  },
  {
    name: 'SRC-IP-SUFFIX',
    example: '192.168.1.201/8',
    validator: isValidIpCidr,
  },
  {
    name: 'SRC-PORT',
    example: '7777',
    validator: (value) => portValidator(value),
  },
  {
    name: 'DST-PORT',
    example: '80',
    validator: (value) => portValidator(value),
  },
  {
    name: 'IN-PORT',
    example: '7897',
    validator: (value) => portValidator(value),
  },
  {
    name: 'DSCP',
    example: '4',
  },
  {
    name: 'PROCESS-NAME',
    example: getSystem() === 'windows' ? 'chrome.exe' : 'curl',
  },
  {
    name: 'PROCESS-PATH',
    example:
      getSystem() === 'windows'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/wget',
  },
  {
    name: 'PROCESS-NAME-REGEX',
    example: '.*telegram.*',
  },
  {
    name: 'PROCESS-PATH-REGEX',
    example:
      getSystem() === 'windows' ? '(?i).*Application\\chrome.*' : '.*bin/wget',
  },
  {
    name: 'NETWORK',
    example: 'udp',
    validator: (value) => ['tcp', 'udp'].includes(value),
  },
  {
    name: 'UID',
    example: '1001',
    validator: (value) => (+value ? true : false),
  },
  {
    name: 'IN-TYPE',
    example: 'SOCKS/HTTP',
  },
  {
    name: 'IN-USER',
    example: 'mihomo',
  },
  {
    name: 'IN-NAME',
    example: 'ss',
  },
  {
    name: 'SUB-RULE',
    example: '(NETWORK,tcp)',
  },
  {
    name: 'RULE-SET',
    example: 'providername',
    noResolve: true,
  },
  {
    name: 'AND',
    example: '((DOMAIN,baidu.com),(NETWORK,UDP))',
  },
  {
    name: 'OR',
    example: '((NETWORK,UDP),(DOMAIN,baidu.com))',
  },
  {
    name: 'NOT',
    example: '((DOMAIN,baidu.com))',
  },
  {
    name: 'MATCH',
    required: false,
  },
]

const RULE_TYPE_LABEL_KEYS: Record<string, string> = Object.fromEntries(
  rules.map((rule) => [
    rule.name,
    `rules.modals.editor.ruleTypes.${rule.name}`,
  ]),
)

const DEFAULT_RULE_TYPE =
  rules.find((rule) => rule.name === 'DOMAIN-SUFFIX') ?? rules[0]

const parseRuleSequences = (data: string): ISeqProfileConfig | undefined => {
  const value = parseYamlSafe(data)
  if (value === null) return { prepend: [], append: [], delete: [] }
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!value) return undefined
  for (const [key, items] of Object.entries(value)) {
    if (!['prepend', 'append', 'delete'].includes(key)) return undefined
    if (
      !Array.isArray(items) ||
      items.some((item) => typeof item !== 'string')
    ) {
      return undefined
    }
  }
  return value as ISeqProfileConfig
}

const builtinProxyPolicies = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS']

const PROXY_POLICY_LABEL_KEYS: Record<string, TranslationKey> =
  builtinProxyPolicies.reduce(
    (acc, policy) => {
      acc[policy] =
        `proxies.components.enums.policies.${policy}` as TranslationKey
      return acc
    },
    {} as Record<string, TranslationKey>,
  )

const findRealIndex = (
  list: string[],
  filtered: string[],
  filteredIndex: number,
): number => {
  const item = filtered[filteredIndex]
  if (item === undefined) return -1
  return list.indexOf(item)
}

export const RulesEditorViewer = (props: Props) => {
  const { groupsUid, mergeUid, profileUid, property, open, onClose, onSave } =
    props
  const { t } = useTranslation()
  const themeMode = useThemeMode()

  const editorRef = useRef<MonacoEditorInstance | null>(null)

  const [prevData, setPrevData] = useState('')
  const [currData, setCurrData] = useState('')
  const [visualization, setVisualization] = useState(true)
  const [advancedRuleForm, setAdvancedRuleForm] = useState(false)
  const [match, setMatch] = useState(() => (_: string) => true)

  const [ruleType, setRuleType] =
    useState<(typeof rules)[number]>(DEFAULT_RULE_TYPE)
  const [ruleContent, setRuleContent] = useState('')
  const [noResolve, setNoResolve] = useState(false)
  const [proxyPolicy, setProxyPolicy] = useState(builtinProxyPolicies[0])
  const [proxyPolicyList, setProxyPolicyList] =
    useState<string[]>(builtinProxyPolicies)
  const [ruleList, setRuleList] = useState<string[]>([])
  const [ruleSetList, setRuleSetList] = useState<string[]>([])
  const [subRuleList, setSubRuleList] = useState<string[]>([])

  const [prependSeq, setPrependSeq] = useState<string[]>([])
  const [appendSeq, setAppendSeq] = useState<string[]>([])
  const [deleteSeq, setDeleteSeq] = useState<string[]>([])
  const hasLoadedSeqConfigRef = useRef(false)

  const filteredPrependSeq = useMemo(
    () => prependSeq.filter((rule) => match(rule)),
    [prependSeq, match],
  )
  const filteredRuleList = useMemo(
    () => ruleList.filter((rule) => match(rule)),
    [ruleList, match],
  )
  const filteredAppendSeq = useMemo(
    () => appendSeq.filter((rule) => match(rule)),
    [appendSeq, match],
  )

  const items = useMemo(
    () =>
      buildGroupedItems(
        filteredPrependSeq,
        filteredRuleList,
        filteredAppendSeq,
        (rule) => rule,
      ),
    [filteredPrependSeq, filteredRuleList, filteredAppendSeq],
  )

  const renderItem = (entry: GroupedVirtualItem<string>) => {
    const { category, item } = entry

    if (category === 'original') {
      const isDeleted = deleteSeq.includes(item)
      return (
        <RuleItem
          type={isDeleted ? 'delete' : 'original'}
          ruleRaw={item}
          onDelete={() => {
            if (isDeleted) {
              setDeleteSeq(deleteSeq.filter((v) => v !== item))
            } else {
              setDeleteSeq((prev) => [...prev, item])
            }
          }}
        />
      )
    }

    if (category === 'prepend') {
      return (
        <RuleItem
          type="prepend"
          ruleRaw={item}
          onDelete={() => {
            setPrependSeq(prependSeq.filter((v) => v !== item))
          }}
          onAppend={() => {
            setAppendSeq((prev) =>
              prev.includes(item) ? prev : [...prev, item],
            )
            setPrependSeq(prependSeq.filter((v) => v !== item))
          }}
        />
      )
    }

    return (
      <RuleItem
        type="append"
        ruleRaw={item}
        onDelete={() => {
          setAppendSeq(appendSeq.filter((v) => v !== item))
        }}
        onPrepend={() => {
          setPrependSeq((prev) =>
            prev.includes(item) ? prev : [...prev, item],
          )
          setAppendSeq(appendSeq.filter((v) => v !== item))
        }}
      />
    )
  }

  const onReorder = (
    category: 'prepend' | 'append',
    activeIndex: number,
    overIndex: number,
  ) => {
    const list = category === 'prepend' ? prependSeq : appendSeq
    const filtered =
      category === 'prepend' ? filteredPrependSeq : filteredAppendSeq
    const setList = category === 'prepend' ? setPrependSeq : setAppendSeq
    const activeRealIndex = findRealIndex(list, filtered, activeIndex)
    const overRealIndex = findRealIndex(list, filtered, overIndex)
    if (
      activeRealIndex < 0 ||
      overRealIndex < 0 ||
      activeRealIndex === overRealIndex
    ) {
      return
    }

    setList(arrayMove(list, activeRealIndex, overRealIndex))
  }

  const fetchContent = useCallback(async () => {
    setAdvancedRuleForm(false)
    hasLoadedSeqConfigRef.current = false
    const data = await readProfileFile(property)
    const obj = parseRuleSequences(data)

    setPrevData(data)
    setCurrData(data)

    if (obj === undefined) {
      setVisualization(false)
      return
    }

    setPrependSeq(obj?.prepend || [])
    setAppendSeq(obj?.append || [])
    setDeleteSeq(obj?.delete || [])
    hasLoadedSeqConfigRef.current = true
  }, [property])

  const handleVisualizationToggle = () => {
    if (visualization) {
      setCurrData(
        yaml.dump(
          { prepend: prependSeq, append: appendSeq, delete: deleteSeq },
          { forceQuotes: true },
        ),
      )
      setVisualization(false)
      return
    }

    const obj = parseRuleSequences(currData)
    if (obj === undefined) {
      hasLoadedSeqConfigRef.current = false
      showNotice.error('rules.modals.editor.form.validation.invalidRule')
      return
    }

    hasLoadedSeqConfigRef.current = true
    setPrependSeq(obj.prepend ?? [])
    setAppendSeq(obj.append ?? [])
    setDeleteSeq(obj.delete ?? [])
    setVisualization(true)
  }

  const fetchProfile = useCallback(async () => {
    const data = await readProfileFile(profileUid) // 原配置文件
    const groupsData = await readProfileFile(groupsUid) // groups配置文件
    const mergeData = await readProfileFile(mergeUid) // merge配置文件
    const globalMergeData = await readProfileFile('Merge') // global merge配置文件

    const rulesObj = parseYamlSafe(data) as { rules: [] } | null

    const originGroupsObj = parseYamlSafe(data) as {
      'proxy-groups': IProxyGroupConfig[]
    } | null
    const originGroups = originGroupsObj?.['proxy-groups'] || []
    const moreGroupsObj = parseYamlSafe(groupsData) as ISeqProfileConfig | null
    const rawPrependGroups = moreGroupsObj?.['prepend']
    const morePrependGroups = Array.isArray(rawPrependGroups)
      ? (rawPrependGroups as IProxyGroupConfig[])
      : []
    const rawAppendGroups = moreGroupsObj?.['append']
    const moreAppendGroups = Array.isArray(rawAppendGroups)
      ? (rawAppendGroups as IProxyGroupConfig[])
      : []
    const rawDeleteGroups = moreGroupsObj?.['delete']
    const moreDeleteGroups: Array<string | { name: string }> = Array.isArray(
      rawDeleteGroups,
    )
      ? (rawDeleteGroups as Array<string | { name: string }>)
      : []
    const groups = morePrependGroups.concat(
      originGroups.filter((group: any) => {
        if (group.name) {
          return !moreDeleteGroups.includes(group.name)
        } else {
          return !moreDeleteGroups.includes(group)
        }
      }),
      moreAppendGroups,
    )

    const originRuleSetObj = parseYamlSafe(data) as {
      'rule-providers': Record<string, unknown>
    } | null
    const originRuleSet = originRuleSetObj?.['rule-providers'] || {}
    const moreRuleSetObj = parseYamlSafe(mergeData) as {
      'rule-providers': Record<string, unknown>
    } | null
    const moreRuleSet = moreRuleSetObj?.['rule-providers'] || {}
    const globalRuleSetObj = parseYamlSafe(globalMergeData) as {
      'rule-providers': Record<string, unknown>
    } | null
    const globalRuleSet = globalRuleSetObj?.['rule-providers'] || {}
    const ruleSet = Object.assign({}, originRuleSet, moreRuleSet, globalRuleSet)

    const originSubRuleObj = parseYamlSafe(data) as {
      'sub-rules': Record<string, unknown>
    } | null
    const originSubRule = originSubRuleObj?.['sub-rules'] || {}
    const moreSubRuleObj = parseYamlSafe(mergeData) as {
      'sub-rules': Record<string, unknown>
    } | null
    const moreSubRule = moreSubRuleObj?.['sub-rules'] || {}
    const globalSubRuleObj = parseYamlSafe(globalMergeData) as {
      'sub-rules': Record<string, unknown>
    } | null
    const globalSubRule = globalSubRuleObj?.['sub-rules'] || {}
    const subRule = Object.assign({}, originSubRule, moreSubRule, globalSubRule)
    setProxyPolicyList(
      builtinProxyPolicies.concat(groups.map((group: any) => group.name)),
    )
    setRuleSetList(Object.keys(ruleSet))
    setSubRuleList(Object.keys(subRule))
    setRuleList(rulesObj?.rules || [])
  }, [groupsUid, mergeUid, profileUid])

  useEffect(() => {
    if (!open) return
    fetchContent()
    fetchProfile()
  }, [fetchContent, fetchProfile, open])

  useEffect(() => {
    return () => {
      editorRef.current?.dispose()
      editorRef.current = null
    }
  }, [])

  const validateRule = (type = ruleType) => {
    if ((type.required ?? true) && !ruleContent) {
      throw new Error(
        t('rules.modals.editor.form.validation.conditionRequired'),
      )
    }
    if (type.validator && !type.validator(ruleContent)) {
      throw new Error(t('rules.modals.editor.form.validation.invalidRule'))
    }
    if (
      !advancedRuleForm &&
      (ruleContent.length > 253 ||
        !ruleContent
          .split('.')
          .every((label) =>
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
          ) ||
        /^\d+(\.\d+){3}$/.test(ruleContent))
    ) {
      throw new Error(t('rules.modals.editor.form.validation.invalidRule'))
    }

    const condition = (type.required ?? true) ? ruleContent : ''
    return `${type.name}${condition ? ',' + condition : ''},${proxyPolicy}${
      type.noResolve && noResolve ? ',no-resolve' : ''
    }`
  }

  const handleSave = useLockFn(async () => {
    try {
      if (!hasLoadedSeqConfigRef.current && visualization) return
      const data = visualization
        ? yaml.dump(
            { prepend: prependSeq, append: appendSeq, delete: deleteSeq },
            { forceQuotes: true },
          )
        : currData
      if (!(await saveProfileFile(property, data))) {
        await fetchContent()
        onClose()
        return
      }
      showNotice.success('shared.feedback.notifications.saved')
      onSave?.(prevData, data)
      onClose()
    } catch (err: any) {
      showNotice.error(err)
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      disableEnforceFocus={!visualization}
    >
      <DialogTitle>
        {
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            {t('rules.modals.editor.title')}
            <Box>
              {visualization && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setAdvancedRuleForm((value) => !value)}
                  sx={{ mr: 1 }}
                >
                  {advancedRuleForm
                    ? t('rules.modals.editor.form.actions.simpleRouting')
                    : t('rules.modals.editor.form.actions.moreRules')}
                </Button>
              )}
              <Button
                variant="contained"
                size="small"
                onClick={handleVisualizationToggle}
              >
                {visualization
                  ? t('rules.modals.editor.form.actions.editYaml')
                  : t('rules.modals.editor.form.actions.backToRouting')}
              </Button>
            </Box>
          </Box>
        }
      </DialogTitle>

      <DialogContent
        sx={{ display: 'flex', width: 'auto', height: 'calc(100vh - 185px)' }}
      >
        {visualization ? (
          <>
            <List
              sx={{
                width: '50%',
                padding: '0 10px',
              }}
            >
              {advancedRuleForm ? (
                <>
                  <Item>
                    <ListItemText
                      primary={t('rules.modals.editor.form.labels.type')}
                    />
                    <Autocomplete
                      size="small"
                      sx={{ minWidth: '240px' }}
                      renderInput={(params) => <TextField {...params} />}
                      options={rules}
                      value={ruleType}
                      getOptionLabel={(option) =>
                        t(RULE_TYPE_LABEL_KEYS[option.name] ?? option.name)
                      }
                      renderOption={(props, option) => {
                        const { key, ...optionProps } = props
                        const label = t(
                          RULE_TYPE_LABEL_KEYS[option.name] ?? option.name,
                        )
                        return (
                          <li key={key} {...optionProps} title={label}>
                            {label}
                          </li>
                        )
                      }}
                      onChange={(_, value) => value && setRuleType(value)}
                    />
                  </Item>
                  <Item
                    sx={{ display: !(ruleType.required ?? true) ? 'none' : '' }}
                  >
                    <ListItemText
                      primary={t('rules.modals.editor.form.labels.content')}
                    />

                    {ruleType.name === 'RULE-SET' && (
                      <Autocomplete
                        size="small"
                        sx={{ minWidth: '240px' }}
                        renderInput={(params) => <TextField {...params} />}
                        options={ruleSetList}
                        value={ruleContent}
                        onChange={(_, value) => value && setRuleContent(value)}
                      />
                    )}
                    {ruleType.name === 'SUB-RULE' && (
                      <Autocomplete
                        size="small"
                        sx={{ minWidth: '240px' }}
                        renderInput={(params) => <TextField {...params} />}
                        options={subRuleList}
                        value={ruleContent}
                        onChange={(_, value) => value && setRuleContent(value)}
                      />
                    )}
                    {ruleType.name !== 'RULE-SET' &&
                      ruleType.name !== 'SUB-RULE' && (
                        <TextField
                          autoComplete="new-password"
                          size="small"
                          sx={{ minWidth: '240px' }}
                          value={ruleContent}
                          required={ruleType.required ?? true}
                          error={(ruleType.required ?? true) && !ruleContent}
                          placeholder={ruleType.example}
                          onChange={(e) => setRuleContent(e.target.value)}
                        />
                      )}
                  </Item>
                </>
              ) : (
                <Item>
                  <ListItemText
                    primary={t('rules.modals.editor.form.labels.domain')}
                    secondary={t('rules.modals.editor.form.hints.domain')}
                  />
                  <TextField
                    autoFocus
                    autoComplete="new-password"
                    size="small"
                    sx={{ minWidth: '240px' }}
                    value={ruleContent}
                    required
                    placeholder="youtube.com"
                    onChange={(e) => setRuleContent(e.target.value.trim())}
                  />
                </Item>
              )}
              <Item>
                <ListItemText
                  primary={
                    advancedRuleForm
                      ? t('rules.modals.editor.form.labels.proxyPolicy')
                      : t('rules.modals.editor.form.labels.routeTo')
                  }
                />
                <Autocomplete
                  size="small"
                  sx={{ minWidth: '240px' }}
                  renderInput={(params) => <TextField {...params} />}
                  options={proxyPolicyList}
                  value={proxyPolicy}
                  getOptionLabel={(option) =>
                    t(PROXY_POLICY_LABEL_KEYS[option] ?? option)
                  }
                  renderOption={(props, option) => {
                    const { key, ...optionProps } = props
                    const label = t(PROXY_POLICY_LABEL_KEYS[option] ?? option)
                    return (
                      <li key={key} {...optionProps} title={label}>
                        {label}
                      </li>
                    )
                  }}
                  onChange={(_, value) => value && setProxyPolicy(value)}
                />
              </Item>
              {advancedRuleForm && ruleType.noResolve && (
                <Item>
                  <ListItemText
                    primary={t('rules.modals.editor.form.toggles.noResolve')}
                  />
                  <Switch
                    checked={noResolve}
                    onChange={() => setNoResolve(!noResolve)}
                  />
                </Item>
              )}
              {advancedRuleForm ? (
                <>
                  <Item>
                    <Button
                      fullWidth
                      variant="contained"
                      startIcon={<VerticalAlignTopRounded />}
                      onClick={() => {
                        try {
                          const raw = validateRule()
                          if (prependSeq.includes(raw)) return
                          setPrependSeq([raw, ...prependSeq])
                        } catch (err: any) {
                          showNotice.error(err)
                        }
                      }}
                    >
                      {t('rules.modals.editor.form.actions.prependRule')}
                    </Button>
                  </Item>
                  <Item>
                    <Button
                      fullWidth
                      variant="contained"
                      startIcon={<VerticalAlignBottomRounded />}
                      onClick={() => {
                        try {
                          const raw = validateRule()
                          if (appendSeq.includes(raw)) return
                          setAppendSeq([...appendSeq, raw])
                        } catch (err: any) {
                          showNotice.error(err)
                        }
                      }}
                    >
                      {t('rules.modals.editor.form.actions.appendRule')}
                    </Button>
                  </Item>
                </>
              ) : (
                <Item>
                  <Button
                    fullWidth
                    variant="contained"
                    startIcon={<VerticalAlignTopRounded />}
                    disabled={!ruleContent.trim()}
                    onClick={() => {
                      try {
                        const raw = validateRule(DEFAULT_RULE_TYPE)
                        if (prependSeq.includes(raw)) return
                        setPrependSeq([raw, ...prependSeq])
                      } catch (err: any) {
                        showNotice.error(err)
                      }
                    }}
                  >
                    {t('rules.modals.editor.form.actions.addRoutingRule')}
                  </Button>
                </Item>
              )}
            </List>

            <List
              sx={{
                width: '50%',
                padding: '0 10px',
              }}
            >
              <BaseSearchBox onSearch={(match) => setMatch(() => match)} />
              <GroupedVirtualList
                items={items}
                renderItem={renderItem}
                onReorder={onReorder}
                style={{ height: 'calc(100% - 24px)', marginTop: '8px' }}
              />
            </List>
          </>
        ) : (
          <MonacoEditor
            height="100%"
            language="yaml"
            value={currData}
            theme={themeMode === 'light' ? 'light' : 'vs-dark'}
            onMount={(editorInstance) => {
              editorRef.current = editorInstance
            }}
            options={{
              tabSize: 2, // 根据语言类型设置缩进大小
              minimap: {
                enabled: document.documentElement.clientWidth >= 1500, // 超过一定宽度显示minimap滚动条
              },
              mouseWheelZoom: true, // 按住Ctrl滚轮调节缩放比例
              quickSuggestions: {
                strings: true, // 字符串类型的建议
                comments: true, // 注释类型的建议
                other: true, // 其他类型的建议
              },
              padding: {
                top: 33, // 顶部padding防止遮挡snippets
              },
              fontFamily: MONACO_FONT_FAMILY,
              fontLigatures: false, // 连字符
              smoothScrolling: true, // 平滑滚动
            }}
            onChange={(value) => setCurrData(value ?? '')}
          />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          {t('shared.actions.cancel')}
        </Button>

        <Button onClick={handleSave} variant="contained">
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const Item = styled(ListItem)(() => ({
  padding: '5px 2px',
}))
