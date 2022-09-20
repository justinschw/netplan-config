type netplanConfig_options = {
  network?: {
    version: number
    renderer: 'networkd' | 'NetworkManager'
    ethernets?: Record<string, unknown>
    wifis?: Record<string, unknown>
  } & Record<string, unknown>
  configFile?: string
}

declare class NetplanConfig {
  static plan: Pick<netplanConfig_options, 'network'>
  static configFile: Pick<netplanConfig_options, 'configFile'>
  static oldConfig: string
  static newConfig: string
  static binary: string
  static ipBinary: string
  static routeBinary: string
  constructor(config?: netplanConfig_options)
  readConfigFile(filePath: string): Record<string, unknown>
  loadConfig(): void
  writeConfig(): void
  configureNetplanInterface(options: {
    name: string
    type: 'ethernet' | 'wifi'
    definition: {
      dhcp4?: 'yes'
      addresses?: string[]
      nameservers?: {
        search: string[]
        address: string[]
      }
      routes?: [
        {
          to: '0.0.0.0/0'
          via: string
        }
      ]
    }
  }): void
  addAccessPoint(
    definition: {
      dhcp4?: 'yes'
      addresses?: string[]
      nameservers?: {
        search: string[]
        address: string[]
      }
      routes?: [
        {
          to: '0.0.0.0/0'
          via: string
        }
      ]
    },
    accessPoint: {
      ssid: string
      wifiPassword: string
    }
  ): void
  configureInterface(
    name: string,
    options:
      | { dhcp: true }
      | {
          dhcp: false
          ip?: string
          prefix?: number
          defaultGateway?: string
          domain?: string
          nameservers?: string[]
          accessPoint?: {
            ssid: string
            wifiPassword: string
          }
        }
  ): void
  static executeBinary(
    binPath: string,
    args?: Record<string, unknown>
  ): Promise<Record<string, unknown>>
  status(): Promise<Record<string, unknown>>
  generate(): Promise<Record<string, unknown>>
  apply(force?: boolean): Promise<void>
}
declare namespace NetplanConfig {
  type NetplanConfigOptions = netplanConfig_options
}

export = NetplanConfig
