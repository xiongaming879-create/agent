FROM docker.elastic.co/elasticsearch/elasticsearch:8.14.0

# 直接用官方新地址在线安装IK，不用本地zip包
RUN bin/elasticsearch-plugin install --batch https://get.infini.cloud/elasticsearch/analysis-ik/8.14.0

ENV discovery.type=single-node
ENV xpack.security.enabled=false
ENV ES_JAVA_OPTS="-Xms512m -Xmx512m"

EXPOSE 9200 9300