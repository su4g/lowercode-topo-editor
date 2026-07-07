import "dotenv/config";
import { defaultNodePorts, type DataSource, type NodeTypeDefinition, type TopologyData } from "@topo-editor/topology-shared";
import { toPrismaJson } from "./common/json";
import { prisma } from "./prisma/client";

const nodeTypes: NodeTypeDefinition[] = [
  {
    id: "breaker",
    name: "断路器",
    category: "equipment",
    template: "basicEquipmentTemplate",
    icon: "breaker",
    defaultSize: { width: 104, height: 92 },
    ports: defaultNodePorts,
    formSchema: [
      { field: "assetNo", label: "资产编号", type: "text" },
      {
        field: "voltageLevel",
        label: "电压等级",
        type: "select",
        options: [
          { label: "400V", value: "400V" },
          { label: "10kV", value: "10kV" }
        ]
      }
    ]
  },
  {
    id: "lab",
    name: "实验室",
    category: "container",
    template: "containerGroupTemplate",
    defaultSize: { width: 320, height: 220 },
    ports: defaultNodePorts,
    isGroup: true,
    canContain: ["equipment", "annotation", "container", "control"],
    groupStyleDefaults: {
      backgroundColor: "#eef6ff",
      borderColor: "#3b82f6",
      backgroundOpacity: 100,
      transparentBackground: false,
      dashedBorder: false
    }
  },
  {
    id: "text",
    name: "文本",
    category: "annotation",
    template: "textTemplate",
    defaultSize: { width: 140, height: 64 },
    ports: defaultNodePorts,
    annotationDefaults: {
      textColor: "#111827",
      textSize: 14
    },
    formSchema: [
      { field: "textTemplate", label: "文本模板", type: "textarea", defaultValue: "电压：${U} V" }
    ]
  },
  {
    id: "button",
    name: "按钮",
    category: "control",
    template: "buttonTemplate",
    defaultSize: { width: 112, height: 42 },
    icon: "按钮",
    ports: [],
    buttonDefaults: {
      buttonText: "按钮",
      buttonRenderMode: "text",
      buttonDefaultVisible: true
    },
    buttonStyleDefaults: {
      backgroundColor: "#eff6ff",
      borderColor: "#2563eb",
      textColor: "#1d4ed8",
      textSize: 13,
      borderWidth: 1.5,
      borderRadius: 6,
      paddingX: 10,
      paddingY: 5
    },
    formSchema: [
      { field: "buttonText", label: "按钮文字", type: "text", defaultValue: "按钮" },
      {
        field: "buttonRenderMode",
        label: "渲染方式",
        type: "select",
        defaultValue: "text",
        options: [
          { label: "文字", value: "text" },
          { label: "图片", value: "image" },
          { label: "图片+文字", value: "imageText" }
        ]
      }
    ]
  }
];

const dataSources: DataSource[] = [
  {
    id: "device_1001",
    name: "1号断路器 mock 数据",
    type: "static",
    enabled: true,
    config: {
      data: {
        breakerState: "closed",
        voltage: 220,
        current: 12.5
      }
    }
  },
  {
    id: "lab_001",
    name: "高压实验室 mock 数据",
    type: "static",
    enabled: true,
    config: {
      data: {
        alarmCount: 1,
        enabled: true
      }
    }
  }
];

const topology: TopologyData = {
  id: "topology_001",
  name: "实验室配电拓扑",
  version: "1.0.0",
  nodes: [
    {
      key: "lab_001",
      typeId: "lab",
      isGroup: true,
      label: "高压实验室",
      loc: "80 60",
      size: "320 220",
      props: { backgroundColor: "#eef6ff" },
      runtime: { backgroundColor: "#eef6ff", borderColor: "#3b82f6" },
      dataBinding: {
        enabled: true,
        sourceId: "lab_001",
        mappings: { alarmCount: "alarmCount", enabled: "enabled" }
      }
    },
    {
      key: "breaker_001",
      typeId: "breaker",
      label: "1号断路器",
      group: "lab_001",
      loc: "180 160",
      size: "104 92",
      props: { assetNo: "BR-001", voltageLevel: "400V" },
      dataBinding: {
        enabled: true,
        sourceId: "device_1001",
        mappings: { state: "breakerState", U: "voltage" }
      }
    },
    {
      key: "text_001",
      typeId: "text",
      label: "电压文本",
      group: "lab_001",
      loc: "180 230",
      size: "140 64",
      props: { textTemplate: "电压：${U} V" },
      dataBinding: {
        enabled: true,
        sourceId: "device_1001",
        mappings: { U: "voltage" }
      },
      runtime: { text: "电压：220 V" }
    }
  ],
  links: []
};

async function upsertNodeType(item: NodeTypeDefinition) {
  await prisma.topologyNodeType.upsert({
    where: { typeCode: item.id },
    update: {
      typeName: item.name,
      category: item.category,
      templateCode: item.template,
      icon: item.icon,
      enabled: true,
      configJson: toPrismaJson({
        description: item.description,
        defaultSize: item.defaultSize,
        statusImages: item.statusImages,
        isGroup: item.isGroup,
        canContain: item.canContain,
        allowNestedGroup: item.allowNestedGroup,
        ports: item.ports ?? [],
        formSchema: item.formSchema ?? [],
        groupStyleDefaults: item.groupStyleDefaults,
        annotationDefaults: item.annotationDefaults,
        buttonDefaults: item.buttonDefaults,
        buttonStyleDefaults: item.buttonStyleDefaults
      })
    },
    create: {
      typeCode: item.id,
      typeName: item.name,
      category: item.category,
      templateCode: item.template,
      icon: item.icon,
      enabled: true,
      configJson: toPrismaJson({
        description: item.description,
        defaultSize: item.defaultSize,
        statusImages: item.statusImages,
        isGroup: item.isGroup,
        canContain: item.canContain,
        allowNestedGroup: item.allowNestedGroup,
        ports: item.ports ?? [],
        formSchema: item.formSchema ?? [],
        groupStyleDefaults: item.groupStyleDefaults,
        annotationDefaults: item.annotationDefaults,
        buttonDefaults: item.buttonDefaults,
        buttonStyleDefaults: item.buttonStyleDefaults
      })
    }
  });
}

async function upsertDataSource(item: DataSource) {
  await prisma.topologyDataSource.upsert({
    where: { sourceCode: item.id },
    update: {
      sourceName: item.name,
      sourceType: item.type,
      enabled: item.enabled ?? true,
      configJson: toPrismaJson(item.config)
    },
    create: {
      sourceCode: item.id,
      sourceName: item.name,
      sourceType: item.type,
      enabled: item.enabled ?? true,
      configJson: toPrismaJson(item.config)
    }
  });
}

async function main() {
  for (const item of nodeTypes) await upsertNodeType(item);
  for (const item of dataSources) await upsertDataSource(item);

  await prisma.topology.upsert({
    where: { topologyCode: topology.id },
    update: {
      topologyName: topology.name,
      status: "draft",
      versions: {
        create: {
          versionNo: topology.version,
          versionName: "种子版本",
          configJson: toPrismaJson(topology),
          createdBy: "seed"
        }
      }
    },
    create: {
      topologyCode: topology.id,
      topologyName: topology.name,
      status: "draft",
      versions: {
        create: {
          versionNo: topology.version,
          versionName: "种子版本",
          configJson: toPrismaJson(topology),
          createdBy: "seed"
        }
      }
    }
  });
}

main()
  .then(async () => {
    console.log("Seed completed");
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
